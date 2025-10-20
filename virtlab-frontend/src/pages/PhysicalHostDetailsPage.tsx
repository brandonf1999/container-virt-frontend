import { Link, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useHostDetails } from "../hooks/useHostDetails";
import { useClusterStorage } from "../hooks/useClusterStorage";
import { useClusterNetworks } from "../hooks/useClusterNetworks";
import { classifyVmState } from "../utils/vm";
import { formatDuration, formatMemory, formatPercent, formatBytes } from "../utils/formatters";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";
import type { StoragePool, VirtualMachine } from "../types";

function formatLabel(value: string | null | undefined) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "--";
  return value ? "Yes" : "No";
}

function getStorageIntent(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();
  switch (normalized) {
    case "running":
    case "available":
    case "active":
      return "ok";
    case "building":
    case "degraded":
      return "warning";
    case "inactive":
    case "missing":
    case "error":
      return "error";
    default:
      return "muted";
  }
}

function makePoolKey(hostname: string | null | undefined, poolName: string | null | undefined) {
  return `${hostname ?? ""}::${poolName ?? ""}`;
}

function getNetworkStateMeta(state: string | null | undefined) {
  const normalized = (state ?? "").toLowerCase();
  switch (normalized) {
    case "active":
      return { label: "Active", intent: "ok" };
    case "degraded":
      return { label: "Degraded", intent: "warning" };
    case "missing":
      return { label: "Missing", intent: "error" };
    case "inactive":
      return { label: "Inactive", intent: "muted" };
    default:
      return { label: formatLabel(state ?? "--"), intent: "muted" };
  }
}

function getHostNetworkStatusMeta(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  switch (normalized) {
    case "active":
      return { label: "Active", intent: "ok" };
    case "inactive":
      return { label: "Inactive", intent: "muted" };
    case "missing":
      return { label: "Missing", intent: "error" };
    default:
      return { label: formatLabel(status ?? "--"), intent: "muted" };
  }
}

export function PhysicalHostDetailsPage() {
  const params = useParams<{ hostname?: string }>();
  const hostname = decodeURIComponent(params.hostname ?? "");

  const { details, isLoading, error, refresh } = useHostDetails(hostname, { pollIntervalMs: 30000 });
  const {
    hosts: storageHosts,
    storageDomains,
    isLoading: isStorageLoading,
    error: storageError,
    refresh: refreshStorage,
  } = useClusterStorage({ pollIntervalMs: 45000 });
  const {
    networks: aggregatedNetworks,
    isLoading: isNetworksLoading,
    error: networksError,
    refresh: refreshNetworks,
  } = useClusterNetworks({ pollIntervalMs: 45000 });

  const cpuMetrics = details?.metrics?.cpu;
  const memoryMetrics = details?.metrics?.memory;
  const guests = details?.guests ?? [];

  const storageInventory = storageHosts[hostname];
  const storagePools = useMemo(() => {
    const pools = storageInventory?.pools ?? [];
    return [...pools].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [storageInventory?.pools]);

  const storageDomainLookup = useMemo(() => {
    const map = new Map<string, string>();
    storageDomains.forEach((domain) => {
      domain.hosts.forEach((host) => {
        const key = makePoolKey(host.hostname, domain.name ?? null);
        map.set(key, domain.id);
      });
    });
    return map;
  }, [storageDomains]);

  const storageErrors = storageInventory?.errors ?? [];
  const hasStoragePools = storagePools.length > 0;

  const guestColumns = useMemo<TableColumn<VirtualMachine>[]>(
    () => [
      {
        id: "name",
        label: "Name",
        sortable: true,
        sortAccessor: (row) => row.name,
        renderCell: (row) => (
          <Link to={`/guest-hosts/${encodeURIComponent(hostname)}/${encodeURIComponent(row.name)}`}>
            {row.name}
          </Link>
        ),
      },
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: (row) => row.state ?? "",
        renderCell: (row) => {
          const { label, intent } = classifyVmState(row.state);
          return <span className={`status-pill status-pill--${intent}`}>{label}</span>;
        },
      },
      {
        id: "vcpus",
        label: "vCPUs",
        sortable: true,
        sortAccessor: (row) => row.metrics?.vcpu_count ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) => row.metrics?.vcpu_count ?? "--",
      },
      {
        id: "memory",
        label: "Memory",
        sortable: true,
        sortAccessor: (row) => row.metrics?.memory_mb ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) =>
          row.metrics?.memory_mb != null ? formatMemory(row.metrics.memory_mb) : "--",
      },
      {
        id: "uptime",
        label: "Uptime",
        sortable: true,
        sortAccessor: (row) => row.metrics?.uptime_seconds ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) =>
          row.metrics?.uptime_seconds != null ? formatDuration(row.metrics.uptime_seconds) : "--",
      },
    ],
    [hostname],
  );

  const guestTable = useTableState(guestColumns, guests, {
    storageKey: hostname ? `host-${hostname}-guests-columns` : undefined,
    defaultVisible: ["name", "state", "vcpus", "memory", "uptime"],
    initialSort: { columnId: "name", direction: "asc" },
  });

  const storagePoolColumns = useMemo<TableColumn<StoragePool>[]>(
    () => [
      {
        id: "name",
        label: "Pool",
        sortable: true,
        sortAccessor: (row) => row.name ?? "",
        renderCell: (row) => {
          const domainId = storageDomainLookup.get(makePoolKey(hostname, row.name ?? null));
          if (domainId) {
            return <Link to={`/storage/pools/${domainId}`}>{row.name ?? "--"}</Link>;
          }
          return row.name ?? "--";
        },
      },
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: (row) => row.state ?? "",
        renderCell: (row) => (
          <span className={`status-pill status-pill--${getStorageIntent(row.state)}`}>
            {formatLabel(row.state ?? null)}
          </span>
        ),
      },
      {
        id: "type",
        label: "Type",
        sortable: true,
        sortAccessor: (row) => row.type ?? "",
        renderCell: (row) => formatLabel(row.type ?? null),
      },
      {
        id: "persistent",
        label: "Persistent",
        sortable: true,
        sortAccessor: (row) => (row.persistent ? 1 : 0),
        renderCell: (row) => formatBoolean(row.persistent),
      },
      {
        id: "autostart",
        label: "Autostart",
        sortable: true,
        sortAccessor: (row) => (row.autostart ? 1 : 0),
        renderCell: (row) => formatBoolean(row.autostart),
      },
      {
        id: "capacity",
        label: "Capacity",
        sortable: true,
        sortAccessor: (row) => row.capacity_bytes ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) => formatBytes(row.capacity_bytes ?? null),
      },
      {
        id: "allocation",
        label: "Allocation",
        sortable: true,
        sortAccessor: (row) => row.allocation_bytes ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) => formatBytes(row.allocation_bytes ?? null),
      },
      {
        id: "available",
        label: "Available",
        sortable: true,
        sortAccessor: (row) => row.available_bytes ?? Number.NEGATIVE_INFINITY,
        renderCell: (row) => formatBytes(row.available_bytes ?? null),
      },
    ],
    [hostname, storageDomainLookup],
  );

  const storagePoolTable = useTableState(storagePoolColumns, storagePools, {
    storageKey: hostname ? `host-${hostname}-storage-columns` : undefined,
    defaultVisible: ["name", "state", "type", "persistent", "autostart", "capacity", "allocation", "available"],
    initialSort: { columnId: "name", direction: "asc" },
  });

  type HostNetworkRow = {
    id: string;
    name: string;
    hostStatus: string;
    networkState: string;
    forward: string;
    bridge?: string | null;
    shared: boolean;
    lastCheckedAt?: string | null;
    message?: string | null;
  };

  const hostNetworkRows = useMemo<HostNetworkRow[]>(() => {
    const rows: HostNetworkRow[] = [];
    aggregatedNetworks.forEach((network) => {
      const hostEntry = network.hosts.find((entry) => entry.hostname === hostname);
      if (!hostEntry) return;
      rows.push({
        id: network.id,
        name: network.name ?? "Unnamed network",
        hostStatus: hostEntry.status ?? "unknown",
        networkState: network.summary?.state ?? "unknown",
        forward: formatLabel(network.forward_mode ?? null),
        bridge: network.bridge_name ?? null,
        shared: Boolean(network.is_shared),
        lastCheckedAt: hostEntry.last_checked_at ?? null,
        message: hostEntry.message ?? null,
      });
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [aggregatedNetworks, hostname]);

  const hostNetworkColumns = useMemo<TableColumn<HostNetworkRow>[]>(
    () => [
      {
        id: "name",
        label: "Network",
        sortable: true,
        sortAccessor: (row) => row.name,
        renderCell: (row) => <Link to={`/networking/networks/${encodeURIComponent(row.id)}`}>{row.name}</Link>,
      },
      {
        id: "host_status",
        label: "Host Status",
        sortable: true,
        sortAccessor: (row) => row.hostStatus ?? "",
        renderCell: (row) => {
          const meta = getHostNetworkStatusMeta(row.hostStatus);
          return <span className={`status-pill status-pill--${meta.intent}`}>{meta.label}</span>;
        },
      },
      {
        id: "network_state",
        label: "Network State",
        sortable: true,
        sortAccessor: (row) => row.networkState ?? "",
        renderCell: (row) => {
          const meta = getNetworkStateMeta(row.networkState);
          return <span className={`status-pill status-pill--${meta.intent}`}>{meta.label}</span>;
        },
      },
      {
        id: "forward",
        label: "Forward Mode",
        sortable: true,
        sortAccessor: (row) => row.forward,
        renderCell: (row) => row.forward,
      },
      {
        id: "bridge",
        label: "Bridge",
        sortable: true,
        sortAccessor: (row) => row.bridge ?? "",
        renderCell: (row) => row.bridge ?? "--",
      },
      {
        id: "shared",
        label: "Shared",
        sortable: true,
        sortAccessor: (row) => (row.shared ? 1 : 0),
        renderCell: (row) => (row.shared ? "Yes" : "No"),
      },
      {
        id: "last_checked",
        label: "Last Checked",
        sortable: true,
        sortAccessor: (row) => row.lastCheckedAt ?? "",
        renderCell: (row) => (row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : "--"),
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

  const hostNetworkTable = useTableState(hostNetworkColumns, hostNetworkRows, {
    storageKey: hostname ? `host-${hostname}-networks-columns` : undefined,
    defaultVisible: ["name", "host_status", "network_state", "forward", "bridge", "shared", "last_checked"],
    initialSort: { columnId: "name", direction: "asc" },
  });

  const handleRefresh = useCallback(() => {
    refresh();
    refreshStorage();
    refreshNetworks();
  }, [refresh, refreshStorage, refreshNetworks]);

  return (
    <div className="page-stack" data-page="physical-host-details">
      <header className="page-header">
        <div>
          <h1>{hostname}</h1>
          <p className="page-header__subtitle">Physical host overview with live metrics and guest inventory.</p>
        </div>
        <div className="page-header__actions">
          <Link className="link-button" to="/physical-hosts">
            ← Back to Physical Hosts
          </Link>
          <button
            type="button"
            className="refresh-button"
            onClick={handleRefresh}
            disabled={isLoading || isStorageLoading || isNetworksLoading}
          >
            {isLoading || isStorageLoading || isNetworksLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section id="host-summary" className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Summary</h2>
          <p className="panel__subtitle">Reported by libvirt host info.</p>
        </header>
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {isLoading && <div className="panel__status">Loading host details…</div>}
        {!isLoading && !details && !error && <div className="panel__status">No host details available.</div>}
        {details && (
          <>
            <div className="summary-grid summary-grid--host">
              <div className="summary-grid__item">
                <div className="summary-grid__label">Architecture</div>
                <div className="summary-grid__value">{details.arch ?? "--"}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">vCPUs</div>
                <div className="summary-grid__value">{details.cpus ?? "--"}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Memory</div>
                <div className="summary-grid__value">{details.memory_MB ? formatMemory(details.memory_MB) : "--"}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Assigned Guests</div>
                <div className="summary-grid__value">{guests.length}</div>
              </div>
            </div>
            <dl className="definition-list definition-list--compact">
              <div className="definition-list__item">
                <dt>URI</dt>
                <dd className="summary-grid__value--mono">{details.uri ?? "--"}</dd>
              </div>
              {cpuMetrics?.sample_period_seconds != null && (
                <div className="definition-list__item">
                  <dt>CPU Sample Window</dt>
                  <dd>{formatDuration(cpuMetrics.sample_period_seconds)}</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </section>

      {details?.metrics && (
        <section id="host-metrics" className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Detailed Metrics</h2>
            <p className="panel__subtitle">CPU and memory telemetry captured via libvirt nodestats.</p>
          </header>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__label">CPU Cores</div>
              <div className="metric-card__value">{cpuMetrics?.cores ?? "--"}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">CPU Usage</div>
              <div className="metric-card__value">
                {cpuMetrics?.usage_percent != null ? formatPercent(cpuMetrics.usage_percent) : "--"}
              </div>
              {cpuMetrics?.times_ns && (
                <div className="metric-card__meta">
                  User: {cpuMetrics.times_ns.user ?? 0} ns · System: {cpuMetrics.times_ns.system ?? 0} ns
                </div>
              )}
            </div>
            <div className="metric-card">
              <div className="metric-card__label">CPU Sample Window</div>
              <div className="metric-card__value">
                {cpuMetrics?.sample_period_seconds != null ? formatDuration(cpuMetrics.sample_period_seconds) : "--"}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Total Memory</div>
              <div className="metric-card__value">
                {memoryMetrics?.total_mb != null ? formatMemory(memoryMetrics.total_mb) : "--"}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Used Memory</div>
              <div className="metric-card__value">
                {memoryMetrics?.used_mb != null ? formatMemory(memoryMetrics.used_mb) : "--"}
              </div>
              {memoryMetrics?.raw && (
                <div className="metric-card__meta">
                  Buffers: {memoryMetrics.raw.buffers ?? 0} KiB · Cached: {memoryMetrics.raw.cached ?? 0} KiB
                </div>
              )}
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Free Memory</div>
              <div className="metric-card__value">
                {memoryMetrics?.free_mb != null ? formatMemory(memoryMetrics.free_mb) : "--"}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Available Memory</div>
              <div className="metric-card__value">
                {memoryMetrics?.available_mb != null ? formatMemory(memoryMetrics.available_mb) : "--"}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Memory Utilization</div>
              <div className="metric-card__value">
                {memoryMetrics?.usage_percent != null ? formatPercent(memoryMetrics.usage_percent) : "--"}
              </div>
            </div>
          </div>
        </section>
      )}

      <section id="host-guests" className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Assigned Guest Hosts</h2>
          <p className="panel__subtitle">Domains currently reported on this physical host.</p>
        </header>
        {guests.length === 0 ? (
          <div className="panel__status">No guest hosts are currently assigned to this machine.</div>
        ) : (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  {guestTable.visibleColumns.map((column) => {
                    const isSorted = guestTable.sortState?.columnId === column.id;
                    const ariaSort = isSorted
                      ? guestTable.sortState?.direction === "asc"
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
                            onClick={() => guestTable.requestSort(column.id)}
                          >
                            {column.label}
                            <span className="table-header-button__icon">
                              {isSorted ? (guestTable.sortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                      columns={guestColumns}
                      visibleColumnIds={guestTable.visibleColumnIds}
                      toggleColumn={guestTable.toggleColumn}
                      canToggleColumn={guestTable.canToggleColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {guestTable.sortedRows.map((row) => (
                  <tr key={row.name}>
                    {guestTable.visibleColumns.map((column) => (
                      <td key={column.id}>{column.renderCell(row)}</td>
                    ))}
                    <td className="table-gear-cell" aria-hidden="true" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="host-storage" className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Mounted Storage Pools</h2>
          <p className="panel__subtitle">Snapshot from the latest storage inventory ingestion.</p>
        </header>
        {isStorageLoading && <div className="panel__status">Loading storage pools…</div>}
        {storageError && !isStorageLoading && (
          <div className="panel__status panel__status--error">{storageError}</div>
        )}
        {!isStorageLoading && !storageError && !hasStoragePools && (
          <div className="panel__status">No storage pools reported for this host.</div>
        )}
        {!isStorageLoading && !storageError && hasStoragePools && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  {storagePoolTable.visibleColumns.map((column) => {
                    const isSorted = storagePoolTable.sortState?.columnId === column.id;
                    const ariaSort = isSorted
                      ? storagePoolTable.sortState?.direction === "asc"
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
                            onClick={() => storagePoolTable.requestSort(column.id)}
                          >
                            {column.label}
                            <span className="table-header-button__icon">
                              {isSorted
                                ? storagePoolTable.sortState?.direction === "asc"
                                  ? "▲"
                                  : "▼"
                                : "↕"}
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
                      columns={storagePoolColumns}
                      visibleColumnIds={storagePoolTable.visibleColumnIds}
                      toggleColumn={storagePoolTable.toggleColumn}
                      canToggleColumn={storagePoolTable.canToggleColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {storagePoolTable.sortedRows.map((row) => (
                  <tr key={row.name ?? row.type ?? "unknown"}>
                    {storagePoolTable.visibleColumns.map((column) => (
                      <td key={column.id}>{column.renderCell(row)}</td>
                    ))}
                    <td className="table-gear-cell" aria-hidden="true" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isStorageLoading && storageErrors.length > 0 && (
          <div className="panel__status panel__status--error">
            {storageErrors.map((message, index) => (
              <div key={`storage-error-${index}`}>{message}</div>
            ))}
          </div>
        )}
      </section>

      <section id="host-networks" className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Libvirt Networks</h2>
          <p className="panel__subtitle">Networks currently reported on this host.</p>
        </header>
        {isNetworksLoading && <div className="panel__status">Loading networks…</div>}
        {networksError && !isNetworksLoading && (
          <div className="panel__status panel__status--error">{networksError}</div>
        )}
        {!isNetworksLoading && !networksError && hostNetworkRows.length === 0 && (
          <div className="panel__status">No libvirt networks reported for this host.</div>
        )}
        {!isNetworksLoading && !networksError && hostNetworkRows.length > 0 && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  {hostNetworkTable.visibleColumns.map((column) => {
                    const isSorted = hostNetworkTable.sortState?.columnId === column.id;
                    const ariaSort = isSorted
                      ? hostNetworkTable.sortState?.direction === "asc"
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
                            onClick={() => hostNetworkTable.requestSort(column.id)}
                          >
                            {column.label}
                            <span className="table-header-button__icon">
                              {isSorted ? (hostNetworkTable.sortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                      columns={hostNetworkColumns}
                      visibleColumnIds={hostNetworkTable.visibleColumnIds}
                      toggleColumn={hostNetworkTable.toggleColumn}
                      canToggleColumn={hostNetworkTable.canToggleColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {hostNetworkTable.sortedRows.map((row) => (
                  <tr key={row.id}>
                    {hostNetworkTable.visibleColumns.map((column) => (
                      <td key={column.id}>{column.renderCell(row)}</td>
                    ))}
                    <td className="table-gear-cell" aria-hidden="true" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
