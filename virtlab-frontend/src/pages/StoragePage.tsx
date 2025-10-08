import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useClusterStorage } from "../hooks/useClusterStorage";
import type { StoragePool, StorageVolume } from "../types";
import { formatBytes } from "../utils/formatters";
import { deleteStoragePool, deleteStorageVolume } from "../api";
import { API_BASE_URL } from "../api";
import { getVolumeStateMeta } from "../utils/storage";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";
import { useActivityLog } from "../hooks/useActivityLog";
import { DeleteConfirmationModal } from "../components/DeleteConfirmationModal";

type StorageRow = {
  host: string;
  pool: StoragePool;
};

type StorageVolumeRow = {
  host: string;
  volume: StorageVolume;
};

type StorageTableView = "domains" | "volumes";

type DeleteTarget =
  | { type: "pool"; host: string; pool: StoragePool }
  | { type: "volume"; host: string; volume: StorageVolume };

type UploadTarget = { host: string; pool: StoragePool };

type PendingAction = { type: "pool" | "volume" | "upload"; key: string };

function makePoolKey(host: string, poolName: string) {
  return `${host}:${poolName}`;
}

function makeVolumeKey(host: string, poolName: string, volumeName: string) {
  return `${host}:${poolName}:${volumeName}`;
}

const TABLE_OPTIONS: Array<{ id: StorageTableView; label: string }> = [
  { id: "domains", label: "Storage Domains" },
  { id: "volumes", label: "Storage Volumes" },
];

const EMPTY_DOMAINS_STATE = "No storage pools reported yet.";
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

export function StoragePage() {
  const { hosts, errors, isLoading, error, refresh } = useClusterStorage();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = (searchParams.get("view") as StorageTableView | null) ?? "domains";
  const [tableView, setTableView] = useState<StorageTableView>(initialView);
  const [confirmTarget, setConfirmTarget] = useState<DeleteTarget | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { addEntry, updateEntry, openPanel } = useActivityLog();

  const poolRows = useMemo(() => {
    const items: StorageRow[] = [];
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.pools.forEach((pool) => {
        items.push({ host: hostname, pool });
      });
    });
    return items.sort((a, b) => {
      if (a.host === b.host) {
        return a.pool.name.localeCompare(b.pool.name);
      }
      return a.host.localeCompare(b.host);
    });
  }, [hosts]);

  const poolColumns = useMemo<TableColumn<StorageRow>[]>(
    () => [
      {
        id: "host",
        label: "Host",
        sortable: true,
        sortAccessor: ({ host }) => host,
        renderCell: ({ host }) => host,
      },
      {
        id: "pool",
        label: "Pool",
        sortable: true,
        sortAccessor: ({ pool }) => pool.name ?? "",
        renderCell: ({ pool }) => (
          <div className="hosts-table__primary">{pool.name}</div>
        ),
      },
      {
        id: "type",
        label: "Type",
        sortable: true,
        sortAccessor: ({ pool }) => pool.type ?? "",
        renderCell: ({ pool }) => formatLabel(pool.type ?? null),
      },
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: ({ pool }) => pool.state ?? "",
        renderCell: ({ pool }) => formatLabel(pool.state),
      },
      {
        id: "persistent",
        label: "Persistent",
        sortable: true,
        sortAccessor: ({ pool }) => (pool.persistent === null ? null : pool.persistent ? 1 : 0),
        renderCell: ({ pool }) => formatBoolean(pool.persistent),
      },
      {
        id: "autostart",
        label: "Autostart",
        sortable: true,
        sortAccessor: ({ pool }) => (pool.autostart === null ? null : pool.autostart ? 1 : 0),
        renderCell: ({ pool }) => formatBoolean(pool.autostart),
      },
      {
        id: "capacity",
        label: "Capacity",
        sortable: true,
        sortAccessor: ({ pool }) => pool.capacity_bytes ?? null,
        renderCell: ({ pool }) => formatBytes(pool.capacity_bytes),
      },
      {
        id: "allocation",
        label: "Allocation",
        sortable: true,
        sortAccessor: ({ pool }) => pool.allocation_bytes ?? null,
        renderCell: ({ pool }) => formatBytes(pool.allocation_bytes),
      },
      {
        id: "available",
        label: "Available",
        sortable: true,
        sortAccessor: ({ pool }) => pool.available_bytes ?? null,
        renderCell: ({ pool }) => formatBytes(pool.available_bytes),
      },
    ],
    [],
  );

  const volumeRows = useMemo(() => {
    const items: StorageVolumeRow[] = [];
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.volumes.forEach((volume) => {
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
    const hostCount = Object.keys(hosts).length;
    const poolCount = poolRows.length;
    const runningPools = poolRows.filter((row) => row.pool.state === "running").length;
    const volumeCount = volumeRows.length;
    return { hostCount, poolCount, runningPools, volumeCount };
  }, [hosts, poolRows, volumeRows]);

  const hasPoolRows = poolRows.length > 0;
  const hasVolumeRows = volumeRows.length > 0;

  const requestDeleteVolume = useCallback((host: string, volume: StorageVolume) => {
    setActionMessage(null);
    setActionError(null);
    setConfirmTarget({ type: "volume", host, volume });
  }, []);

  const requestDeletePool = useCallback((host: string, pool: StoragePool) => {
    setActionMessage(null);
    setActionError(null);
    setConfirmTarget({ type: "pool", host, pool });
  }, []);

  const requestUploadPool = useCallback((host: string, pool: StoragePool) => {
    setActionMessage(null);
    setActionError(null);
    setUploadTarget({ host, pool });
  }, []);

  const performDelete = useCallback(
    async (target: DeleteTarget) => {
      const key =
        target.type === "pool"
          ? makePoolKey(target.host, target.pool.name ?? "")
          : makeVolumeKey(target.host, target.volume.pool ?? "", target.volume.name ?? "");

      const poolName = target.type === "pool" ? target.pool.name ?? "" : target.volume.pool ?? "";
      const volumeName = target.type === "volume" ? target.volume.name ?? "" : "";
      const entryTitle =
        target.type === "pool"
          ? `Delete storage pool ${poolName}`
          : `Delete storage volume ${volumeName}`;
      const entryDetail =
        target.type === "pool"
          ? `Host ${target.host}`
          : `Pool ${poolName} · Host ${target.host}`;

      const entryId = addEntry({
        title: entryTitle,
        detail: entryDetail,
        scope: "storage",
        status: "pending",
      });

      setActionMessage(null);
      setActionError(null);
      setPendingAction({ type: target.type, key });

      try {
        if (target.type === "pool") {
          const response = await deleteStoragePool(target.host, poolName);
          const messageHost = response?.host ?? target.host;
          const messagePool = response?.pool ?? poolName;
          const successDetail = `Deleted ${messagePool} on ${messageHost}.`;
          setActionMessage(successDetail);
          updateEntry(entryId, { status: "success", detail: successDetail });
        } else {
          const response = await deleteStorageVolume(target.host, poolName, volumeName);
          const messageHost = response?.host ?? target.host;
          const messagePool = response?.pool ?? poolName;
          const messageVolume = response?.volume ?? volumeName;
          const successDetail = `Deleted ${messageVolume} from ${messagePool} on ${messageHost}.`;
          setActionMessage(successDetail);
          updateEntry(entryId, { status: "success", detail: successDetail });
        }
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

  const handleUploadSubmit = useCallback(
    async ({
      file,
      volumeName,
      overwrite,
      format,
      onProgress,
    }: {
      file: File;
      volumeName: string;
      overwrite: boolean;
      format: string | null;
      onProgress: (loaded: number, total: number) => void;
    }) => {
      if (!uploadTarget) return;
      const poolName = uploadTarget.pool.name ?? "";
      const key = makePoolKey(uploadTarget.host, poolName);

      const entryId = addEntry({
        title: `Upload storage volume ${volumeName}`,
        detail: `Pool ${poolName} · Host ${uploadTarget.host}`,
        scope: "storage",
        status: "pending",
      });

      setPendingAction({ type: "upload", key });
      setIsUploading(true);
      setActionMessage(null);
      setActionError(null);

      try {
        const response = await new Promise<import("../types").StorageVolumeDetailsResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "POST",
            `${API_BASE_URL}/api/hosts/${encodeURIComponent(uploadTarget.host)}/storage/pools/${encodeURIComponent(poolName)}/upload`,
            true,
          );
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              onProgress(event.loaded, event.total);
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("Failed to parse upload response"));
              }
            } else {
              try {
                const payload = JSON.parse(xhr.responseText || "{}");
                const detail = payload?.detail;
                if (typeof detail === "string") {
                  reject(new Error(detail));
                  return;
                }
                if (detail && typeof detail === "object" && typeof detail.message === "string") {
                  reject(new Error(detail.message));
                  return;
                }
              } catch {
                /* noop */
              }
              reject(new Error(`Upload storage volume HTTP ${xhr.status}`));
            }
          };

          const formData = new FormData();
          formData.set("file", file);
          formData.set("volume", volumeName);
          formData.set("overwrite", overwrite ? "true" : "false");
          if (format) {
            formData.set("volume_format", format);
          }

          xhr.send(formData);
        });
        const messageVolume = response.volume.name ?? volumeName;
        const messagePool = response.pool.name ?? poolName;
        const messageHost = response.host ?? uploadTarget.host;
        const successDetail = `Uploaded ${messageVolume} to ${messagePool} on ${messageHost}.`;
        setActionMessage(successDetail);
        updateEntry(entryId, { status: "success", detail: successDetail });
        setUploadTarget(null);
        refresh();
      } catch (err) {
        const failure = err instanceof Error ? err.message : String(err);
        setActionError(failure);
        updateEntry(entryId, { status: "error", detail: failure });
        openPanel();
      } finally {
        setPendingAction(null);
        setIsUploading(false);
      }
    },
    [addEntry, openPanel, refresh, updateEntry, uploadTarget],
  );

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

  const poolTable = useTableState(poolColumns, poolRows, {
    defaultVisible: ["pool", "type", "state", "autostart", "capacity", "allocation"],
    storageKey: "storage-pool-columns",
    initialSort: { columnId: "pool", direction: "asc" },
  });

  const {
    visibleColumns: poolVisibleColumns,
    visibleColumnIds: poolVisibleIds,
    toggleColumn: togglePoolColumn,
    canToggleColumn: canTogglePoolColumn,
    sortedRows: poolSortedRows,
    sortState: poolSortState,
    requestSort: requestPoolSort,
  } = poolTable;

  const modalProcessing =
    !!confirmTarget &&
    pendingAction?.type === confirmTarget.type &&
    pendingAction.key ===
      (confirmTarget.type === "pool"
        ? makePoolKey(confirmTarget.host, confirmTarget.pool.name ?? "")
        : makeVolumeKey(
            confirmTarget.host,
            confirmTarget.volume.pool ?? "",
            confirmTarget.volume.name ?? "",
          ));

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
            {stats.poolCount} pool{stats.poolCount === 1 ? "" : "s"} across {stats.hostCount} host
            {stats.hostCount === 1 ? "" : "s"}; {stats.runningPools} running. {stats.volumeCount} volume
            {stats.volumeCount === 1 ? "" : "s"} detected.
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

        {!isLoading && !error && tableView === "domains" && !hasPoolRows && (
          <div className="panel__status">{EMPTY_DOMAINS_STATE}</div>
        )}

        {!isLoading && !error && tableView === "domains" && hasPoolRows && (
          <>
            <div className="table-wrapper">
              <table className="hosts-table hosts-table--metrics">
                <thead>
                  <tr>
                    {poolVisibleColumns.map((column) => {
                      const isSorted = poolSortState?.columnId === column.id;
                      const ariaSort = isSorted
                        ? poolSortState?.direction === "asc"
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
                              onClick={() => requestPoolSort(column.id)}
                            >
                              {column.label}
                              <span className="table-header-button__icon">
                                {isSorted ? (poolSortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                        columns={poolColumns}
                        visibleColumnIds={poolVisibleIds}
                        toggleColumn={togglePoolColumn}
                        canToggleColumn={canTogglePoolColumn}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {poolSortedRows.map((row) => {
                    const key = makePoolKey(row.host, row.pool.name ?? "");
                    const isDeleting = pendingAction?.type === "pool" && pendingAction.key === key;
                    const isUploadPending = pendingAction?.type === "upload" && pendingAction.key === key;
                    return (
                      <tr key={key}>
                        {poolVisibleColumns.map((column) => (
                          <td key={column.id}>{column.renderCell(row)}</td>
                        ))}
                        <td className="table-gear-cell">
                          <div className="table-gear-cell__actions">
                            <button
                              type="button"
                              className="hosts-table__action-button"
                              onClick={() => requestUploadPool(row.host, row.pool)}
                              disabled={
                                isUploadPending ||
                                isDeleting ||
                                isLoading ||
                                isUploading
                              }
                            >
                              {isUploadPending ? "Uploading…" : "Upload"}
                            </button>
                            <button
                              type="button"
                              className="hosts-table__action-button hosts-table__action-button--danger"
                              onClick={() => requestDeletePool(row.host, row.pool)}
                              disabled={isDeleting || isLoading || isUploadPending}
                            >
                              {isDeleting ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
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

      {uploadTarget && (
        <UploadVolumeModal
          target={uploadTarget}
          onCancel={() => {
            if (isUploading) return;
            setUploadTarget(null);
          }}
          onSubmit={handleUploadSubmit}
          isProcessing={isUploading}
        />
      )}

      {confirmTarget && (() => {
        const requiredName =
          confirmTarget.type === "pool"
            ? confirmTarget.pool.name ?? ""
            : confirmTarget.volume.name ?? "";
        const locationText =
          confirmTarget.type === "pool"
            ? `storage pool ${confirmTarget.pool.name ?? ""} on ${confirmTarget.host}`
            : `storage volume ${confirmTarget.volume.name ?? ""} in pool ${confirmTarget.volume.pool ?? ""} on ${confirmTarget.host}`;
        return (
          <DeleteConfirmationModal
            title={confirmTarget.type === "pool" ? "Delete storage pool" : "Delete storage volume"}
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

type UploadVolumeModalProps = {
  target: UploadTarget;
  onCancel: () => void;
  onSubmit: (payload: {
    file: File;
    volumeName: string;
    overwrite: boolean;
    format: string | null;
    onProgress: (loaded: number, total: number) => void;
  }) => void;
  isProcessing: boolean;
};

function UploadVolumeModal({ target, onCancel, onSubmit, isProcessing }: UploadVolumeModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [volumeName, setVolumeName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [format, setFormat] = useState("raw");
  const [formatDirty, setFormatDirty] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  const poolName = target.pool.name ?? "";
  const hostName = target.host;

  useEffect(() => {
    setFile(null);
    setVolumeName("");
    setNameDirty(false);
    setFormat("raw");
    setFormatDirty(false);
    setOverwrite(false);
    setProgress(null);
    const timer = window.setTimeout(() => fileInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!isProcessing) onCancel();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isProcessing, onCancel]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    if (nextFile && !nameDirty) {
      const base = nextFile.name.replace(/\.[^.]+$/, "");
      setVolumeName(base || nextFile.name);
    }
    if (nextFile && !formatDirty) {
      const ext = nextFile.name.split(".").pop()?.toLowerCase();
      if (ext === "qcow2" || ext === "qcow") {
        setFormat("qcow2");
      } else if (ext === "vmdk") {
        setFormat("vmdk");
      } else {
        setFormat("raw");
      }
    }
  }, [formatDirty, nameDirty]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!file) return;
      const trimmed = volumeName.trim();
      if (!trimmed) return;
      onSubmit({
        file,
        volumeName: trimmed,
        overwrite,
        format,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
    },
    [file, format, onSubmit, overwrite, volumeName],
  );

  const canSubmit = Boolean(file && volumeName.trim() && !isProcessing);

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!isProcessing) onCancel();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-volume-title"
        aria-describedby="upload-volume-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="upload-volume-title">Upload storage volume</h2>
            <p id="upload-volume-description">
              Upload a disk image to pool <strong>{poolName}</strong> on <strong>{hostName}</strong>.
            </p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onCancel}
            disabled={isProcessing}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form className="modal__body" onSubmit={handleSubmit}>
          <div className="modal__input-group">
            <label htmlFor="upload-volume-file">Disk image</label>
            <input
              ref={fileInputRef}
              id="upload-volume-file"
              type="file"
              accept=".qcow2,.qcow,.img,.raw,.iso,.vmdk,.qcow2.gz,.qcow.gz"
              onChange={handleFileChange}
              disabled={isProcessing}
              required
            />
          </div>

          <div className="modal__input-group">
            <label htmlFor="upload-volume-name">Volume name</label>
            <input
              id="upload-volume-name"
              type="text"
              value={volumeName}
              onChange={(event) => {
                setVolumeName(event.target.value);
                if (!nameDirty) setNameDirty(true);
              }}
              disabled={isProcessing}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>

          <div className="modal__input-group">
            <label htmlFor="upload-volume-format">Format</label>
            <select
              id="upload-volume-format"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
                if (!formatDirty) setFormatDirty(true);
              }}
              disabled={isProcessing}
            >
              <option value="raw">raw</option>
              <option value="qcow2">qcow2</option>
              <option value="vmdk">vmdk</option>
            </select>
          </div>

          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              disabled={isProcessing}
            />
            Overwrite existing volume if present
          </label>

          {progress && (
            <div className="modal__progress" aria-live="polite">
              <div className="modal__progress-bar">
                <div
                  className="modal__progress-bar-fill"
                  style={{ width: `${Math.min((progress.loaded / progress.total) * 100, 100)}%` }}
                />
              </div>
              <div className="modal__progress-label">
                {Math.round((progress.loaded / progress.total) * 100)}%
                {progress.total ? ` · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : ""}
              </div>
            </div>
          )}

          <div className="modal__actions">
            <button
              type="button"
              className="hosts-table__action-button"
              onClick={onCancel}
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="hosts-table__action-button"
              disabled={!canSubmit}
            >
              {isProcessing ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
