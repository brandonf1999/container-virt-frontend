import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useNetworkDetails } from "../hooks/useNetworkDetails";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";

function formatLabel(value: string | null | undefined) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function getStateMeta(state: string | null | undefined) {
  const normalized = (state ?? "").toLowerCase();
  switch (normalized) {
    case "active":
      return { label: "Active", intent: "ok" };
    case "inactive":
      return { label: "Inactive", intent: "muted" };
    case "degraded":
      return { label: "Degraded", intent: "warning" };
    case "missing":
      return { label: "Missing", intent: "error" };
    default:
      return { label: formatLabel(state), intent: "muted" };
  }
}

export function NetworkDetailsPage() {
  const params = useParams<{ networkId?: string }>();
  const networkId = params.networkId ?? "";

  const { network, isLoading, error, refresh } = useNetworkDetails(networkId);

  const hostColumns = useMemo<TableColumn<NonNullable<typeof network>["hosts"][number]>[]>(
    () => [
      {
        id: "hostname",
        label: "Host",
        sortable: true,
        sortAccessor: (row) => row.display_name ?? row.hostname ?? "",
        renderCell: (row) => {
          const display = row.display_name ?? row.hostname ?? "--";
          const host = row.hostname ?? row.display_name;
          if (!host) return display;
          return <Link to={`/physical-hosts/${encodeURIComponent(host)}`}>{display}</Link>;
        },
      },
      {
        id: "status",
        label: "Status",
        sortable: true,
        sortAccessor: (row) => row.status ?? "",
        renderCell: (row) => {
          const meta = getStateMeta(row.status);
          return <span className={`status-pill status-pill--${meta.intent}`}>{meta.label}</span>;
        },
      },
      {
        id: "message",
        label: "Message",
        sortable: true,
        sortAccessor: (row) => row.message ?? "",
        renderCell: (row) => row.message ?? "--",
      },
      {
        id: "last_checked_at",
        label: "Last Checked",
        sortable: true,
        sortAccessor: (row) => row.last_checked_at ?? "",
        renderCell: (row) => {
          if (!row.last_checked_at) return "--";
          return new Date(row.last_checked_at).toLocaleString();
        },
      },
    ],
    [],
  );

  const hostTable = useTableState(hostColumns, network?.hosts ?? [], {
    storageKey: network ? `network-${network.id}-hosts-columns` : undefined,
    defaultVisible: ["hostname", "status", "message", "last_checked_at"],
    initialSort: { columnId: "hostname", direction: "asc" },
  });

  const stateMeta = getStateMeta(network?.summary?.state);
  const attentionHosts = network?.summary?.attention_hosts ?? [];

  return (
    <div className="page-stack" data-page="network-details">
      <header className="page-header">
        <div>
          <h1>{network?.name ?? "Network"}</h1>
          <p className="page-header__subtitle">Aggregated status across reporting hosts.</p>
        </div>
        <div className="page-header__actions">
          <Link className="link-button" to="/networking">
            ← Back to Networking
          </Link>
          <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Summary</h2>
          <p className="panel__subtitle">Details captured via libvirt and stored inventory.</p>
        </header>
        {isLoading && <div className="panel__status">Loading network…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {!isLoading && !error && !network && (
          <div className="panel__status">Network not found.</div>
        )}
        {network && !isLoading && !error && (
          <div className="summary-grid">
            <div className="summary-grid__item">
              <div className="summary-grid__label">State</div>
              <div className="summary-grid__value">
                <span className={`status-pill status-pill--${stateMeta.intent}`}>{stateMeta.label}</span>
              </div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Forward Mode</div>
              <div className="summary-grid__value">{formatLabel(network.forward_mode ?? null)}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Bridge</div>
              <div className="summary-grid__value">{network.bridge_name ?? "--"}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Shared</div>
              <div className="summary-grid__value">{network.is_shared ? "Yes" : "No"}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Hosts Reporting</div>
              <div className="summary-grid__value">{network.summary?.host_count ?? 0}</div>
            </div>
            <div className="summary-grid__item summary-grid__item--wide">
              <div className="summary-grid__label">Description</div>
              <div className="summary-grid__value">{network.description ?? "--"}</div>
            </div>
          </div>
        )}
      </section>

      {network && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Host Status</h2>
            <p className="panel__subtitle">Per-host availability and diagnostics.</p>
          </header>
          {network.hosts.length === 0 ? (
            <div className="panel__status">No hosts currently report this network.</div>
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
                    <tr key={row.hostname}>
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
      )}

      {attentionHosts.length > 0 && (
        <section className="panel panel--warning">
          <header className="panel__header">
            <h2 className="panel__title">Attention</h2>
            <p className="panel__subtitle">Hosts requiring follow-up for this network.</p>
          </header>
          <ul className="attention-list">
            {attentionHosts.map((host) => {
              const display = host.display_name ?? host.hostname ?? "unknown host";
              const status = host.status ? host.status.replace(/_/g, " ") : "unknown";
              const message = host.message ? ` (${host.message})` : "";
              return (
                <li key={`${display}-${status}`}>
                  <span className="attention-list__name">{display}</span>
                  {` – ${status}${message}`}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {network?.options && Object.keys(network.options).length > 0 && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Additional Options</h2>
            <p className="panel__subtitle">Raw attributes captured from libvirt.</p>
          </header>
          <pre className="code-block">{JSON.stringify(network.options, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}

export default NetworkDetailsPage;
