import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useClusterStorage } from "../hooks/useClusterStorage";
import type { StorageDomainAggregate, StorageVolume } from "../types";
import { formatBytes } from "../utils/formatters";
import { deleteStorageVolume } from "../api";
import { getVolumeStateMeta } from "../utils/storage";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";
import { useActivityLog } from "../hooks/useActivityLog";
import { DeleteConfirmationModal } from "../components/DeleteConfirmationModal";

type StorageVolumeRow = {
  host: string;
  volume: StorageVolume;
};

type StorageTableView = "domains" | "volumes";

type DeleteTarget = { type: "volume"; host: string; volume: StorageVolume };

type PendingAction = { type: "volume"; key: string };

function makeVolumeKey(host: string, poolName: string, volumeName: string) {
  return `${host}:${poolName}:${volumeName}`;
}

const TABLE_OPTIONS: Array<{ id: StorageTableView; label: string }> = [
  { id: "domains", label: "Storage Domains" },
  { id: "volumes", label: "Storage Volumes" },
];

const EMPTY_VOLUMES_STATE = "No storage volumes reported yet.";

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "--";
  return value ? "Yes" : "No";
}

function formatLabel(value: string | null | undefined) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function getStatusIntent(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();
  switch (normalized) {
    case "available":
      return "ok";
    case "degraded":
      return "warning";
    case "missing":
      return "error";
    default:
      return "muted";
  }
}

export function StoragePage() {
  const { hosts, storageDomains, errors, isLoading, error, refresh } = useClusterStorage();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialViewParam = searchParams.get("view");
  const initialView = TABLE_OPTIONS.some((option) => option.id === initialViewParam)
    ? (initialViewParam as StorageTableView)
    : "domains";
  const [tableView, setTableView] = useState<StorageTableView>(initialView);
  const [confirmTarget, setConfirmTarget] = useState<DeleteTarget | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { addEntry, updateEntry, openPanel } = useActivityLog();

  const volumeRows = useMemo(() => {
    const items: StorageVolumeRow[] = [];
    const seen = new Set<string>();
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.volumes.forEach((volume) => {
        const dedupeKey = `${volume.pool ?? ""}::${volume.name ?? ""}`;
        if (seen.has(dedupeKey)) {
          return;
        }
        seen.add(dedupeKey);
        items.push({ host: hostname, volume });
      });
    });
    return items.sort((a, b) => {
      if (a.host === b.host) {
        if (a.volume.pool === b.volume.pool) {
          return a.volume.name.localeCompare(b.volume.name);
        }
        return a.volume.pool.localeCompare(b.volume.pool);
      }
      return a.host.localeCompare(b.host);
    });
  }, [hosts]);

  const volumeColumns = useMemo<TableColumn<StorageVolumeRow>[]>(
    () => [
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: ({ volume }) => (volume.state ?? "").toLowerCase(),
        renderCell: ({ volume }) => {
          const meta = getVolumeStateMeta(volume.state);
          return <span className={`status-pill status-pill--${meta.intent}`}>{meta.label}</span>;
        },
      },
      {
        id: "name",
        label: "Volume",
        sortable: true,
        sortAccessor: ({ volume }) => volume.name ?? "",
        renderCell: ({ host, volume }) => (
          <div className="hosts-table__primary">
            <Link
              to={`/storage/hosts/${encodeURIComponent(host)}/pools/${encodeURIComponent(volume.pool)}/volumes/${encodeURIComponent(volume.name)}`}
            >
              {volume.name}
            </Link>
          </div>
        ),
      },
      {
        id: "pool",
        label: "Pool",
        sortable: true,
        sortAccessor: ({ volume }) => volume.pool ?? "",
        renderCell: ({ volume }) => volume.pool,
      },
      {
        id: "type",
        label: "Type",
        sortable: true,
        sortAccessor: ({ volume }) => volume.type ?? "",
        renderCell: ({ volume }) => formatLabel(volume.type ?? null),
      },
      {
        id: "capacity",
        label: "Capacity",
        sortable: true,
        sortAccessor: ({ volume }) => volume.capacity_bytes ?? null,
        renderCell: ({ volume }) => formatBytes(volume.capacity_bytes ?? null),
      },
      {
        id: "allocation",
        label: "Allocation",
        sortable: true,
        sortAccessor: ({ volume }) => volume.allocation_bytes ?? null,
        renderCell: ({ volume }) => formatBytes(volume.allocation_bytes ?? null),
      },
      {
        id: "available",
        label: "Available",
        sortable: true,
        sortAccessor: ({ volume }) => volume.available_bytes ?? null,
        renderCell: ({ volume }) => formatBytes(volume.available_bytes ?? null),
      },
      {
        id: "path",
        label: "Path",
        sortable: true,
        sortAccessor: ({ volume }) => volume.path ?? "",
        renderCell: ({ volume }) => volume.path ?? "--",
      },
    ],
    [],
  );

  const inventoryErrors = useMemo(() => {
    const list: Array<{ host: string; message: string }> = [];
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.errors?.forEach((message) => {
        list.push({ host: hostname, message });
      });
    });
    return list;
  }, [hosts]);

  const connectionErrors = useMemo(() => {
    if (!errors) return [] as Array<{ host: string; message: string }>;
    return Object.entries(errors).map(([host, message]) => ({ host, message }));
  }, [errors]);

  const stats = useMemo(() => {
    const inventories = Object.values(hosts);
    const hostCount = inventories.length;
    let poolCount = 0;
    let runningPools = 0;
    inventories.forEach((inventory) => {
      const pools = inventory.pools ?? [];
      poolCount += pools.length;
      runningPools += pools.filter((pool) => pool.state === "running").length;
    });
    const volumeCount = volumeRows.length;
    return { hostCount, poolCount, runningPools, volumeCount };
  }, [hosts, volumeRows]);

  const aggregatedStats = useMemo(() => {
    const total = storageDomains.length;
    const shared = storageDomains.filter((domain) => domain.is_shared).length;
    return { total, shared };
  }, [storageDomains]);

  const aggregatedColumns = useMemo<TableColumn<StorageDomainAggregate>[]>(
    () => [
      {
        id: "name",
        label: "Domain",
        sortable: true,
        sortAccessor: (domain) => domain.name,
        renderCell: (domain) => (
          <div className="hosts-table__primary">
            <Link to={`/storage/pools/${domain.id}`}>{domain.name}</Link>
          </div>
        ),
      },
      {
        id: "type",
        label: "Type",
        sortable: true,
        sortAccessor: (domain) => domain.type ?? "",
        renderCell: (domain) => formatLabel(domain.type),
      },
      {
        id: "shared",
        label: "Shared",
        sortable: true,
        sortAccessor: (domain) => (domain.is_shared ? 1 : 0),
        renderCell: (domain) => formatBoolean(domain.is_shared),
      },
      {
        id: "host_count",
        label: "Hosts",
        sortable: true,
        sortAccessor: (domain) => domain.summary.host_count,
        renderCell: (domain) => domain.summary.host_count,
      },
      {
        id: "status",
        label: "Status",
        sortable: true,
        sortAccessor: (domain) => (domain.status ?? "").toLowerCase(),
        renderCell: (domain) => (
          <div className="status-pills">
            <span className={`status-pill status-pill--${getStatusIntent(domain.status)}`}>
              {formatLabel(domain.status)}
              {domain.summary.status_counts[domain.status]
                ? ` (${domain.summary.status_counts[domain.status]})`
                : ""}
            </span>
            {Object.entries(domain.summary.status_counts)
              .filter(([status]) => status !== domain.status)
              .map(([status, count]) => (
                <span key={status} className={`status-pill status-pill--${getStatusIntent(status)}`}>
                  {formatLabel(status)} ({count})
                </span>
              ))}
          </div>
        ),
      },
      {
        id: "last_checked",
        label: "Last Checked",
        sortable: true,
        sortAccessor: (domain) => domain.summary.last_checked_at ?? "",
        renderCell: (domain) =>
          domain.summary.last_checked_at ? new Date(domain.summary.last_checked_at).toLocaleString() : "--",
      },
    ],
    [],
  );

  const aggregatedTable = useTableState(aggregatedColumns, storageDomains, {
    storageKey: "storage-aggregated-columns",
    defaultVisible: ["name", "type", "shared", "host_count", "status"],
    initialSort: { columnId: "name", direction: "asc" },
  });

  const {
    visibleColumns: aggregatedVisibleColumns,
    visibleColumnIds: aggregatedVisibleIds,
    toggleColumn: toggleAggregatedColumn,
    canToggleColumn: canToggleAggregatedColumn,
    sortedRows: aggregatedSortedRows,
    requestSort: requestAggregatedSort,
    sortState: aggregatedSortState,
  } = aggregatedTable;

  const hasAggregatedRows = storageDomains.length > 0;
  const hasVolumeRows = volumeRows.length > 0;

  const requestDeleteVolume = useCallback((host: string, volume: StorageVolume) => {
    setActionMessage(null);
    setActionError(null);
    setConfirmTarget({ type: "volume", host, volume });
  }, []);

  const performDelete = useCallback(
    async (target: DeleteTarget) => {
      const key = makeVolumeKey(target.host, target.volume.pool ?? "", target.volume.name ?? "");
      const poolName = target.volume.pool ?? "";
      const volumeName = target.volume.name ?? "";
      const entryTitle = `Delete storage volume ${volumeName}`;
      const entryDetail = `Pool ${poolName} · Host ${target.host}`;

      const entryId = addEntry({
        title: entryTitle,
        detail: entryDetail,
        scope: "storage",
        status: "pending",
      });

      setActionMessage(null);
      setActionError(null);
      setPendingAction({ type: "volume", key });

      try {
        const response = await deleteStorageVolume(target.host, poolName, volumeName);
        const messageHost = response?.host ?? target.host;
        const messagePool = response?.pool ?? poolName;
        const messageVolume = response?.volume ?? volumeName;
        const successDetail = `Deleted ${messageVolume} from ${messagePool} on ${messageHost}.`;
        setActionMessage(successDetail);
        updateEntry(entryId, { status: "success", detail: successDetail });
        refresh();
      } catch (err) {
        const failure = err instanceof Error ? err.message : String(err);
        setActionError(failure);
        updateEntry(entryId, { status: "error", detail: failure });
        openPanel();
      } finally {
        setPendingAction(null);
        setConfirmTarget(null);
      }
    },
    [addEntry, openPanel, refresh, updateEntry],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!confirmTarget) return;
    void performDelete(confirmTarget);
  }, [confirmTarget, performDelete]);

  const volumeTable = useTableState(volumeColumns, volumeRows, {
    defaultVisible: ["state", "name", "pool", "type", "capacity", "allocation"],
    storageKey: "storage-volume-columns",
    initialSort: { columnId: "name", direction: "asc" },
  });

  const {
    visibleColumns: volumeVisibleColumns,
    visibleColumnIds: volumeVisibleIds,
    toggleColumn: toggleVolumeColumn,
    canToggleColumn: canToggleVolumeColumn,
    sortedRows: volumeSortedRows,
    sortState: volumeSortState,
    requestSort: requestVolumeSort,
  } = volumeTable;

  const modalProcessing =
    !!confirmTarget &&
    pendingAction?.type === "volume" &&
    pendingAction.key ===
      makeVolumeKey(
        confirmTarget.host,
        confirmTarget.volume.pool ?? "",
        confirmTarget.volume.name ?? "",
      );

  return (
    <div className="page-stack" data-page="storage">
      <header className="page-header">
        <div>
          <h1>Storage</h1>
          <p className="page-header__subtitle">
            Libvirt storage pools with capacity, allocation, and availability per host.
          </p>
        </div>
        <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Storage Pools</h2>
          <p className="panel__subtitle">
            {aggregatedStats.total} storage domain{aggregatedStats.total === 1 ? "" : "s"}
            ({aggregatedStats.shared} shared) aggregated across {stats.hostCount} host
            {stats.hostCount === 1 ? "" : "s"}. {stats.poolCount} pool{stats.poolCount === 1 ? "" : "s"}
            detected with {stats.runningPools} running and {stats.volumeCount} volume
            {stats.volumeCount === 1 ? "" : "s"} captured.
          </p>
        </header>

        {isLoading && <div className="panel__status">Loading storage pools…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}

        {!isLoading && !error && (
          <div className="table-selector" role="tablist" aria-label="Storage table selector">
            {TABLE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`table-selector__button${tableView === option.id ? " table-selector__button--active" : ""}`}
                onClick={() => {
                  setTableView(option.id);
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("view", option.id);
                    return next;
                  }, { replace: true });
                }}
                role="tab"
                aria-selected={tableView === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {!isLoading && !error && tableView === "domains" && !hasAggregatedRows && (
          <div className="panel__status">No storage domains recorded yet.</div>
        )}

        {!isLoading && !error && tableView === "domains" && hasAggregatedRows && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  {aggregatedVisibleColumns.map((column) => {
                    const isSorted = aggregatedSortState?.columnId === column.id;
                    const ariaSort = isSorted
                      ? aggregatedSortState?.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none";
                    return (
                      <th key={column.id} scope="col" aria-sort={ariaSort}>
                        {column.sortable ? (
                          <button
                            type="button"
                            className={`table-header-button table-header-button--sortable${
                              isSorted ? " table-header-button--active" : ""
                            }`}
                            onClick={() => requestAggregatedSort(column.id)}
                          >
                            {column.label}
                            <span className="table-header-button__icon">
                              {isSorted ? (aggregatedSortState?.direction === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="table-gear-header" aria-label="Column settings">
                    <ColumnSelector
                      columns={aggregatedColumns}
                      visibleColumnIds={aggregatedVisibleIds}
                      toggleColumn={toggleAggregatedColumn}
                      canToggleColumn={canToggleAggregatedColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {aggregatedSortedRows.map((domain) => (
                  <tr key={domain.id}>
                    {aggregatedVisibleColumns.map((column) => (
                      <td key={column.id}>{column.renderCell(domain)}</td>
                    ))}
                    <td className="table-gear-cell" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !error && tableView === "volumes" && !hasVolumeRows && (
          <div className="panel__status">{EMPTY_VOLUMES_STATE}</div>
        )}

        {actionMessage && !isLoading && !error && (
          <div className="panel__status panel__status--success">{actionMessage}</div>
        )}
        {actionError && !isLoading && !error && (
          <div className="panel__status panel__status--error">{actionError}</div>
        )}

        {!isLoading && !error && tableView === "volumes" && hasVolumeRows && (
          <>
            <div className="table-wrapper">
              <table className="hosts-table hosts-table--metrics">
                <thead>
                  <tr>
                    {volumeVisibleColumns.map((column) => {
                      const isSorted = volumeSortState?.columnId === column.id;
                      const ariaSort = isSorted
                        ? volumeSortState?.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none";
                      return (
                        <th key={column.id} scope="col" aria-sort={ariaSort}>
                          {column.sortable ? (
                            <button
                              type="button"
                              className={`table-header-button table-header-button--sortable${
                                isSorted ? " table-header-button--active" : ""
                              }`}
                              onClick={() => requestVolumeSort(column.id)}
                            >
                              {column.label}
                              <span className="table-header-button__icon">
                                {isSorted ? (volumeSortState?.direction === "asc" ? "▲" : "▼") : "↕"}
                              </span>
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      );
                    })}
                    <th scope="col" className="table-gear-header" aria-label="Column settings">
                      <ColumnSelector
                        columns={volumeColumns}
                        visibleColumnIds={volumeVisibleIds}
                        toggleColumn={toggleVolumeColumn}
                        canToggleColumn={canToggleVolumeColumn}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {volumeSortedRows.map((row) => {
                    const key = makeVolumeKey(row.host, row.volume.pool ?? "", row.volume.name ?? "");
                    const isDeleting = pendingAction?.type === "volume" && pendingAction.key === key;
                    return (
                      <tr key={key}>
                        {volumeVisibleColumns.map((column) => (
                          <td key={column.id}>{column.renderCell(row)}</td>
                        ))}
                        <td className="table-gear-cell">
                          <button
                            type="button"
                            className="hosts-table__action-button hosts-table__action-button--danger"
                            onClick={() => requestDeleteVolume(row.host, row.volume)}
                            disabled={isDeleting || isLoading}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!isLoading && !error && connectionErrors.length > 0 && (
          <div className="panel__status panel__status--error">
            {connectionErrors.map(({ host, message }) => (
              <div key={`${host}:${message}`}>{`${host}: ${message}`}</div>
            ))}
          </div>
        )}

        {!isLoading && !error && inventoryErrors.length > 0 && (
          <div className="panel__status panel__status--error">
            {inventoryErrors.map(({ host, message }) => (
              <div key={`${host}:${message}`}>{`${host}: ${message}`}</div>
            ))}
          </div>
        )}

      </section>

      {confirmTarget && (() => {
        const requiredName =
          confirmTarget.volume.name ?? "";
        const locationText = `storage volume ${confirmTarget.volume.name ?? ""} in pool ${confirmTarget.volume.pool ?? ""} on ${confirmTarget.host}`;
        return (
          <DeleteConfirmationModal
            title="Delete storage volume"
            description="This action cannot be undone."
            entityName={requiredName}
            onCancel={() => setConfirmTarget(null)}
            onConfirm={handleConfirmDelete}
            isProcessing={Boolean(modalProcessing)}
            inputLabel={
              <span>
                Type <code>{requiredName}</code>
              </span>
            }
          >
            <p className="modal__danger-text">You are about to permanently delete the {locationText}.</p>
          </DeleteConfirmationModal>
        );
      })()}
    </div>
  );
}
