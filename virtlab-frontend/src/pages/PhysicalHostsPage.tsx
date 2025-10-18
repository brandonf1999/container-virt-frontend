import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { HostInfo } from "../types";
import { formatConnectionType, formatMemory, formatPercent, formatSampleWindow } from "../utils/formatters";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";

type PhysicalHostsPageProps = {
  hosts: HostInfo[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
};

const EMPTY_STATE = "No hosts reported yet.";

export function PhysicalHostsPage({ hosts, isLoading, error, onRefresh }: PhysicalHostsPageProps) {
  const hasHosts = hosts.length > 0;

  const hostColumns = useMemo<TableColumn<HostInfo>[]>(
    () => [
      {
        id: "hostname",
        label: "Hostname",
        sortable: true,
        sortAccessor: (host) => host.hostname ?? "",
        renderCell: (host) => (
          <div>
            <div className="hosts-table__primary">
              <Link to={`/physical-hosts/${encodeURIComponent(host.hostname)}`}>{host.hostname}</Link>
            </div>
            <div className="hosts-table__meta">{host.arch}</div>
          </div>
        ),
      },
      {
        id: "cpuUsage",
        label: "CPU Usage",
        sortable: true,
        sortAccessor: (host) => host.metrics?.cpu?.usage_percent ?? null,
        renderCell: (host) => {
          const cpu = host.metrics?.cpu;
          const memory = host.metrics?.memory;
          const cpuUsage = formatPercent(cpu?.usage_percent);
          const memoryUsage = formatPercent(memory?.usage_percent);
          return (
            <div>
              <div className="hosts-table__primary">{cpuUsage}</div>
              <div className="hosts-table__meta hosts-table__meta--muted">
                {memoryUsage !== "--" ? `Mem ${memoryUsage}` : ""}
              </div>
            </div>
          );
        },
      },
      {
        id: "cores",
        label: "Cores",
        sortable: true,
        sortAccessor: (host) => host.metrics?.cpu?.cores ?? host.cpus ?? null,
        renderCell: (host) => host.metrics?.cpu?.cores ?? host.cpus ?? "--",
      },
      {
        id: "sampleWindow",
        label: "Sample Window",
        sortable: true,
        sortAccessor: (host) => host.metrics?.cpu?.sample_period_seconds ?? null,
        renderCell: (host) => formatSampleWindow(host.metrics?.cpu?.sample_period_seconds),
      },
      {
        id: "memoryUsage",
        label: "Memory Usage",
        sortable: true,
        sortAccessor: (host) => host.metrics?.memory?.used_mb ?? null,
        renderCell: (host) => {
          const memory = host.metrics?.memory;
          const memoryUsed = formatMemory(memory?.used_mb ?? null);
          const memoryTotal = formatMemory(memory?.total_mb ?? host.memory_MB);
          return (
            <div>
              <div className="hosts-table__primary">{memoryUsed}</div>
              <div className="hosts-table__meta hosts-table__meta--muted">of {memoryTotal}</div>
            </div>
          );
        },
      },
      {
        id: "memoryFree",
        label: "Memory Free",
        sortable: true,
        sortAccessor: (host) => host.metrics?.memory?.free_mb ?? null,
        renderCell: (host) => formatMemory(host.metrics?.memory?.free_mb ?? null),
      },
      {
        id: "connection",
        label: "Connection",
        sortable: true,
        sortAccessor: (host) => host.uri ?? "",
        renderCell: (host) => formatConnectionType(host.uri),
      },
    ],
    [],
  );

  const hostTable = useTableState(hostColumns, hosts, {
    defaultVisible: [
      "hostname",
      "cpuUsage",
      "cores",
      "sampleWindow",
      "memoryUsage",
      "memoryFree",
      "connection",
    ],
    storageKey: "physical-hosts-columns",
    initialSort: { columnId: "hostname", direction: "asc" },
  });

  const {
    visibleColumns: hostVisibleColumns,
    visibleColumnIds: hostVisibleIds,
    toggleColumn: toggleHostColumn,
    canToggleColumn: canToggleHostColumn,
    sortedRows: hostSortedRows,
    sortState: hostSortState,
    requestSort: requestHostSort,
  } = hostTable;

  return (
    <div className="page-stack" data-page="physical-hosts">
      <header className="page-header">
        <div>
          <h1>Physical Hosts</h1>
          <p className="page-header__subtitle">Current compute and memory utilization per libvirt host.</p>
        </div>
        <button type="button" className="refresh-button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="panel">
        {isLoading && <div className="panel__status">Loading hosts…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {!isLoading && !error && !hasHosts && <div className="panel__status">{EMPTY_STATE}</div>}

        {!isLoading && !error && hasHosts && (
          <>
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
                    <tr key={row.hostname}>
                      {hostVisibleColumns.map((column) => (
                        <td key={column.id}>{column.renderCell(row)}</td>
                      ))}
                      <td className="table-gear-cell" aria-hidden="true" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
