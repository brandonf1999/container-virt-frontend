import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { deleteStorageVolume } from "../api";
import type { StorageDomainHostStatus } from "../types";
import { formatBytes } from "../utils/formatters";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";
import { useClusterStorage } from "../hooks/useClusterStorage";
import type { StorageVolume } from "../types";
import { getVolumeStateMeta } from "../utils/storage";
import { DeleteConfirmationModal } from "../components/DeleteConfirmationModal";
import { useStorageDomainDetails } from "../hooks/useStorageDomainDetails";

function formatLabel(value: string | null | undefined) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "--";
  return value ? "Yes" : "No";
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

function makeVolumeKey(host: string, poolName: string | null | undefined, volumeName: string | null | undefined) {
  return `${host}:${poolName ?? ""}:${volumeName ?? ""}`;
}

type VolumeRow = {
  host: string;
  volume: StorageVolume;
};

export function StorageDomainDetailsPage() {
  const { storageId } = useParams<{ storageId: string }>();
  const { hosts: storageHosts } = useClusterStorage();
  const [confirmVolume, setConfirmVolume] = useState<VolumeRow | null>(null);
  const [pendingVolumeKey, setPendingVolumeKey] = useState<string | null>(null);
  const [volumeActionMessage, setVolumeActionMessage] = useState<string | null>(null);
  const [volumeActionError, setVolumeActionError] = useState<string | null>(null);
  const {
    domain,
    isLoading,
    error,
    refresh: refreshDomain,
  } = useStorageDomainDetails(storageId, { pollIntervalMs: 45000 });

  const handleRefresh = useCallback(() => {
    refreshDomain();
  }, [refreshDomain]);

  const hostColumns = useMemo<TableColumn<StorageDomainHostStatus>[]>(
    () => [
      {
        id: "hostname",
        label: "Host",
        sortable: true,
        sortAccessor: (row) => row.display_name ?? row.hostname,
        renderCell: (row) => {
          const display = row.display_name ?? row.hostname;
          return row.hostname ? (
            <Link to={`/physical-hosts/${encodeURIComponent(row.hostname)}`}>{display}</Link>
          ) : (
            <span>{display}</span>
          );
        },
      },
      {
        id: "scope",
        label: "Scope",
        sortable: true,
        sortAccessor: (row) => row.scope,
        renderCell: (row) => formatLabel(row.scope),
      },
      {
        id: "status",
        label: "Status",
        sortable: true,
        sortAccessor: (row) => row.status,
        renderCell: (row) => {
          const intent = getStatusIntent(row.status);
          return <span className={`status-pill status-pill--${intent}`}>{formatLabel(row.status)}</span>;
        },
      },
      {
        id: "capacity",
        label: "Capacity",
        sortable: true,
        sortAccessor: (row) => row.capacity_bytes ?? null,
        renderCell: (row) => formatBytes(row.capacity_bytes ?? null),
      },
      {
        id: "allocation",
        label: "Allocation",
        sortable: true,
        sortAccessor: (row) => row.allocation_bytes ?? null,
        renderCell: (row) => formatBytes(row.allocation_bytes ?? null),
      },
      {
        id: "available",
        label: "Available",
        sortable: true,
        sortAccessor: (row) => row.available_bytes ?? null,
        renderCell: (row) => formatBytes(row.available_bytes ?? null),
      },
      {
        id: "last_checked",
        label: "Last Checked",
        sortable: true,
        sortAccessor: (row) => row.last_checked_at ?? "",
        renderCell: (row) => (row.last_checked_at ? new Date(row.last_checked_at).toLocaleString() : "--"),
      },
      {
        id: "message",
        label: "Message",
        sortable: true,
        sortAccessor: (row) => row.message ?? "",
        renderCell: (row) => row.message ?? "--",
      },
    ],
    [],
  );

  const hostTable = useTableState(
    hostColumns,
    domain?.hosts ?? [],
    {
      storageKey: storageId ? `storage-domain-${storageId}-hosts-columns` : undefined,
      defaultVisible: ["hostname", "scope", "status", "capacity", "allocation", "available"],
    },
  );

  const {
    visibleColumns: hostVisibleColumns,
    visibleColumnIds: hostVisibleIds,
    toggleColumn: toggleHostColumn,
    canToggleColumn: canToggleHostColumn,
    sortedRows: hostSortedRows,
    requestSort: requestHostSort,
    sortState: hostSortState,
  } = hostTable;

  const volumeRows = useMemo<VolumeRow[]>(() => {
    if (!domain) return [];
    const rows: VolumeRow[] = [];
    const seen = new Set<string>();
    Object.entries(storageHosts).forEach(([host, inventory]) => {
      (inventory.volumes ?? []).forEach((volume) => {
        if ((volume.pool ?? "") === domain.name) {
          const dedupeKey = `${volume.pool ?? ""}::${volume.name ?? ""}`;
          if (seen.has(dedupeKey)) {
            return;
          }
          seen.add(dedupeKey);
          rows.push({ host, volume });
        }
      });
    });
    return rows.sort((a, b) => {
      const nameCompare = (a.volume.name ?? "").localeCompare(b.volume.name ?? "");
      if (nameCompare !== 0) return nameCompare;
      return a.host.localeCompare(b.host);
    });
  }, [domain, storageHosts]);


  const volumeColumns = useMemo<TableColumn<VolumeRow>[]>(
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
              to={`/storage/hosts/${encodeURIComponent(host)}/pools/${encodeURIComponent(volume.pool ?? "")}/volumes/${encodeURIComponent(volume.name ?? "")}`}
            >
              {volume.name ?? "Unnamed volume"}
            </Link>
          </div>
        ),
      },
      {
        id: "host",
        label: "Host",
        sortable: true,
        sortAccessor: ({ host }) => host,
        renderCell: ({ host }) => host,
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

  const volumeTable = useTableState(volumeColumns, volumeRows, {
    storageKey: storageId ? `storage-domain-${storageId}-volumes-columns` : undefined,
    defaultVisible: ["state", "name", "host", "type", "capacity", "allocation"],
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

  const requestDeleteVolume = useCallback((row: VolumeRow) => {
    setVolumeActionMessage(null);
    setVolumeActionError(null);
    setConfirmVolume(row);
  }, []);

  const handleDeleteVolume = useCallback(async () => {
    if (!confirmVolume) return;
    const host = confirmVolume.host;
    const poolName = confirmVolume.volume.pool ?? "";
    const volumeName = confirmVolume.volume.name ?? "";
    const key = makeVolumeKey(host, poolName, volumeName);
    setPendingVolumeKey(key);
    try {
      const response = await deleteStorageVolume(host, poolName, volumeName);
      const messageHost = response?.host ?? host;
      const messagePool = response?.pool ?? poolName;
      const messageVolume = response?.volume ?? volumeName;
      setVolumeActionMessage(`Deleted ${messageVolume} from ${messagePool} on ${messageHost}.`);
      refreshDomain();
    } catch (err) {
      setVolumeActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingVolumeKey(null);
      setConfirmVolume(null);
    }
  }, [confirmVolume, refreshDomain]);

  const statusEntries = useMemo(() => {
    if (!domain) return [] as Array<{ status: string; count: number }>;
    return Object.entries(domain.summary.status_counts).map(([status, count]) => ({
      status,
      count,
    }));
  }, [domain]);

  const lastChecked = domain?.summary.last_checked_at
    ? new Date(domain.summary.last_checked_at).toLocaleString()
    : "--";

  const sourceHostLink = useMemo(() => {
    if (!domain?.source_host) return "--";
    return (
      <Link to={`/physical-hosts/${encodeURIComponent(domain.source_host)}`}>{domain.source_host}</Link>
    );
  }, [domain?.source_host]);

  return (
    <div className="page-stack" data-page="storage-domain-details">
      <header className="page-header">
        <div>
          <h1>{domain?.name ?? "Storage Domain"}</h1>
          <p className="page-header__subtitle">
            Aggregated status for pools reporting under <Link to="/storage">Storage</Link>.
          </p>
        </div>
        <div className="page-header__actions">
          <Link className="link-button" to="/storage">
            ← Back to Storage Overview
          </Link>
          <button type="button" className="refresh-button" onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Domain Summary</h2>
          <p className="panel__subtitle">Latest inventory across reporting hosts.</p>
        </header>
        {isLoading && <div className="panel__status">Loading storage domain…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {!isLoading && !error && !domain && (
          <div className="panel__status">Storage domain not found.</div>
        )}
        {domain && !isLoading && !error && (
          <>
            <div className="summary-grid">
              <div className="summary-grid__item">
                <div className="summary-grid__label">Domain</div>
                <div className="summary-grid__value">{domain.name}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Type</div>
                <div className="summary-grid__value">{formatLabel(domain.type)}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Shared</div>
                <div className="summary-grid__value">{formatBoolean(domain.is_shared)}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Status</div>
                <div className="summary-grid__value">
                  <span className={`status-pill status-pill--${getStatusIntent(domain.status)}`}>
                    {formatLabel(domain.status)}
                  </span>
                </div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Hosts Reporting</div>
                <div className="summary-grid__value">{domain.summary.host_count}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Last Checked</div>
                <div className="summary-grid__value">{lastChecked}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Source Host</div>
                <div className="summary-grid__value">{sourceHostLink}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Source Path</div>
                <div className="summary-grid__value summary-grid__value--mono">
                  {domain.source_path ?? "--"}
                </div>
              </div>
              <div className="summary-grid__item summary-grid__item--wide">
                <div className="summary-grid__label">Description</div>
                <div className="summary-grid__value">{domain.description ?? "--"}</div>
              </div>
            </div>

            <div className="status-pills status-pills--wrap">
              {statusEntries.length === 0 ? (
                <span className="status-pill status-pill--muted">No status reported</span>
              ) : (
                statusEntries.map(({ status, count }) => (
                  <span key={status} className={`status-pill status-pill--${getStatusIntent(status)}`}>
                    {formatLabel(status)} ({count})
                  </span>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {domain && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Host Mounts</h2>
            <p className="panel__subtitle">Per-host capacity and availability details.</p>
          </header>
          {domain.hosts.length === 0 ? (
            <div className="panel__status">No hosts are reporting this storage domain.</div>
          ) : (
            <div className="table-wrapper">
              <table className="hosts-table hosts-table--metrics">
                <thead>
                  <tr>
                    {hostVisibleColumns.map((column) => {
                      const isSorted = hostSortState?.columnId === column.id;
                      const ariaSort = isSorted
                        ? hostSortState?.direction === "asc"
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
                              onClick={() => requestHostSort(column.id)}
                            >
                              {column.label}
                              <span className="table-header-button__icon">
                                {isSorted ? (hostSortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                        columns={hostColumns}
                        visibleColumnIds={hostVisibleIds}
                        toggleColumn={toggleHostColumn}
                        canToggleColumn={canToggleHostColumn}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hostSortedRows.map((row) => (
                    <tr key={`${row.hostname}-${row.scope}`}>
                      {hostVisibleColumns.map((column) => (
                        <td key={column.id}>{column.renderCell(row)}</td>
                      ))}
                      <td className="table-gear-cell" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {domain && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Storage Volumes</h2>
            <p className="panel__subtitle">Volumes reported under domain {domain.name}.</p>
          </header>
          {volumeActionMessage && (
            <div className="panel__status panel__status--success">{volumeActionMessage}</div>
          )}
          {volumeActionError && (
            <div className="panel__status panel__status--error">{volumeActionError}</div>
          )}
          {volumeRows.length === 0 ? (
            <div className="panel__status">No storage volumes recorded for this domain.</div>
          ) : (
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
                    const rowKey = makeVolumeKey(row.host, row.volume.pool ?? "", row.volume.name ?? "");
                    const isPending = pendingVolumeKey === rowKey;
                    return (
                      <tr key={`${row.host}-${row.volume.pool}-${row.volume.name}`}>
                        {volumeVisibleColumns.map((column) => (
                          <td key={column.id}>{column.renderCell(row)}</td>
                        ))}
                        <td className="table-gear-cell">
                          <button
                            type="button"
                            className="hosts-table__action-button hosts-table__action-button--danger"
                            onClick={() => requestDeleteVolume(row)}
                            disabled={isPending || isLoading}
                          >
                            {isPending ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {confirmVolume && (
        <DeleteConfirmationModal
          title="Delete storage volume"
          description="This action cannot be undone."
          entityName={confirmVolume.volume.name ?? ""}
          onCancel={() => setConfirmVolume(null)}
          onConfirm={handleDeleteVolume}
          isProcessing={Boolean(pendingVolumeKey)}
          inputLabel={
            <span>
              Type <code>{confirmVolume.volume.name ?? ""}</code>
            </span>
          }
        >
          <p className="modal__danger-text">
            You are about to permanently delete the storage volume {confirmVolume.volume.name ?? ""} from pool {confirmVolume.volume.pool ?? ""} on host {confirmVolume.host}.
          </p>
        </DeleteConfirmationModal>
      )}
    </div>
  );
}

export default StorageDomainDetailsPage;
