import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LibvirtNetworksTable, type AttentionNetwork, type LibvirtNetworkRow } from "../components/LibvirtNetworksTable";
import { useClusterNetworks } from "../hooks/useClusterNetworks";
import type { TableColumn } from "../utils/table";
import { ColumnSelector, useTableState } from "../utils/table";

function formatLabel(value: string | null | undefined) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function NetworkPage() {
  const { hosts, networks, errors, summary, isLoading, error, refresh } = useClusterNetworks();

  const networkRows = useMemo<LibvirtNetworkRow[]>(
    () =>
      networks.map((network) => ({
        id: network.id,
        name: network.name ?? "Unnamed network",
        forward: formatLabel(network.forward_mode ?? null),
        bridge: network.bridge_name ?? null,
        shared: Boolean(network.is_shared),
        description: network.description ?? null,
        state: network.summary?.state ?? "unknown",
      })),
    [networks],
  );

  const attention = useMemo<AttentionNetwork[]>(
    () =>
      networks
        .filter((network) => (network.summary?.attention_hosts?.length ?? 0) > 0)
        .map((network) => ({
          id: network.id,
          name: network.name ?? "Unnamed network",
          hosts: network.summary?.attention_hosts ?? [],
        })),
    [networks],
  );

  type HostInventoryRow = {
    host: string;
    networkCount: number;
    interfaceCount: number;
    issues: string[];
    connectionError: string | null;
  };

  const hostInventoryRows = useMemo<HostInventoryRow[]>(() => {
    const rows = new Map<string, HostInventoryRow>();

    Object.entries(hosts).forEach(([hostname, inventory]) => {
      rows.set(hostname, {
        host: hostname,
        networkCount: inventory.networks?.length ?? 0,
        interfaceCount: inventory.interfaces?.length ?? 0,
        issues: inventory.errors ?? [],
        connectionError: null,
      });
    });

    Object.entries(errors ?? {}).forEach(([hostname, message]) => {
      const existing = rows.get(hostname);
      if (existing) {
        existing.connectionError = message;
      } else {
        rows.set(hostname, {
          host: hostname,
          networkCount: 0,
          interfaceCount: 0,
          issues: [],
          connectionError: message,
        });
      }
    });

    return Array.from(rows.values()).sort((a, b) => a.host.localeCompare(b.host));
  }, [errors, hosts]);

  const hostColumns = useMemo<TableColumn<HostInventoryRow>[]>(
    () => [
      {
        id: "host",
        label: "Host",
        sortable: true,
        sortAccessor: (row) => row.host,
        renderCell: (row) => <Link to={`/physical-hosts/${encodeURIComponent(row.host)}`}>{row.host}</Link>,
      },
      {
        id: "network_count",
        label: "Libvirt Networks",
        sortable: true,
        sortAccessor: (row) => row.networkCount,
        renderCell: (row) => row.networkCount,
      },
      {
        id: "interface_count",
        label: "Interfaces",
        sortable: true,
        sortAccessor: (row) => row.interfaceCount,
        renderCell: (row) => row.interfaceCount,
      },
      {
        id: "issues",
        label: "Issues",
        sortable: true,
        sortAccessor: (row) => {
          if (row.connectionError) return row.connectionError;
          if (row.issues.length > 0) return row.issues.join("; ");
          return "";
        },
        renderCell: (row) => {
          if (row.connectionError) {
            return <span className="status-pill status-pill--error">{row.connectionError}</span>;
          }
          if (row.issues.length > 0) {
            return row.issues.map((issue, index) => (
              <div key={`${row.host}-issue-${index}`}>{issue}</div>
            ));
          }
          return <span className="status-pill status-pill--ok">Healthy</span>;
        },
      },
    ],
    [],
  );

  const hostTable = useTableState(hostColumns, hostInventoryRows, {
    storageKey: "network-host-inventory-columns",
    defaultVisible: ["host", "network_count", "interface_count", "issues"],
    initialSort: { columnId: "host", direction: "asc" },
  });

  const summaryStats = useMemo(() => {
    const total = networks.length;
    const stateCounts = networks.reduce(
      (acc, network) => {
        const key = (network.summary?.state ?? "unknown").toLowerCase();
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      total,
      active: (stateCounts.active ?? 0) as number,
      degraded: (stateCounts.degraded ?? 0) as number,
      missing: (stateCounts.missing ?? 0) as number,
      summary,
    };
  }, [networks, summary]);

  return (
    <div className="page-stack" data-page="networking">
      <header className="page-header">
        <div>
          <h1>Networking</h1>
          <p className="page-header__subtitle">Cluster-wide libvirt networking inventory.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="panel" id="networks-summary">
        <header className="panel__header">
          <h2 className="panel__title">Summary</h2>
          <p className="panel__subtitle">Aggregated state from the latest ingestion.</p>
        </header>
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {isLoading && <div className="panel__status">Loading network inventory…</div>}
        {!isLoading && !error && (
          <div className="summary-grid">
            <div className="summary-grid__item">
              <div className="summary-grid__label">Total Networks</div>
              <div className="summary-grid__value">{summaryStats.total}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Active</div>
              <div className="summary-grid__value">{summaryStats.active}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Degraded</div>
              <div className="summary-grid__value">{summaryStats.degraded}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Missing</div>
              <div className="summary-grid__value">{summaryStats.missing}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Hosts Reporting</div>
              <div className="summary-grid__value">{summary?.reported_hosts ?? Object.keys(hosts).length}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Connection Issues</div>
              <div className="summary-grid__value">{Object.keys(errors ?? {}).length}</div>
            </div>
          </div>
        )}
      </section>

      <section className="panel" id="networks-aggregated">
        <header className="panel__header">
          <h2 className="panel__title">Libvirt Networks</h2>
          <p className="panel__subtitle">Deduplicated network definitions sourced from the database.</p>
        </header>
        <LibvirtNetworksTable rows={networkRows} attention={attention} isLoading={isLoading} error={error} />
      </section>

      <section className="panel" id="networks-host-coverage">
        <header className="panel__header">
          <h2 className="panel__title">Host Coverage</h2>
          <p className="panel__subtitle">Per-host libvirt network reporting and issues.</p>
        </header>
        {hostInventoryRows.length === 0 ? (
          <div className="panel__status">No hosts have reported network inventory yet.</div>
        ) : (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  {hostTable.visibleColumns.map((column) => {
                    const isSorted = hostTable.sortState?.columnId === column.id;
                    const ariaSort = isSorted
                      ? hostTable.sortState?.direction === "asc"
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
                            onClick={() => hostTable.requestSort(column.id)}
                          >
                            {column.label}
                            <span className="table-header-button__icon">
                              {isSorted ? (hostTable.sortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                      visibleColumnIds={hostTable.visibleColumnIds}
                      toggleColumn={hostTable.toggleColumn}
                      canToggleColumn={hostTable.canToggleColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {hostTable.sortedRows.map((row) => (
                  <tr key={row.host}>
                    {hostTable.visibleColumns.map((column) => (
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

export default NetworkPage;
