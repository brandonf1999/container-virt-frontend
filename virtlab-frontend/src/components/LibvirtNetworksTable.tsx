import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { TableColumn } from "../utils/table";
import { ColumnSelector, useTableState } from "../utils/table";
import type { NetworkHostStatus } from "../types";

function getNetworkStateMeta(state: string | null | undefined) {
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
      return { label: formatLabel(state ?? "--"), intent: "muted" };
  }
}

function formatLabel(value: string) {
  if (!value) return "--";
  const cleaned = value.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export type LibvirtNetworkRow = {
  id: string;
  name: string;
  forward: string;
  bridge?: string | null;
  shared: boolean;
  description?: string | null;
  state: string;
};

export type AttentionNetwork = {
  id: string;
  name: string;
  hosts: NetworkHostStatus[];
};

interface Props {
  rows: LibvirtNetworkRow[];
  attention?: AttentionNetwork[];
  isLoading?: boolean;
  error?: string | null;
}

export function LibvirtNetworksTable({ rows, attention = [], isLoading, error }: Props) {
  const columns = useMemo<TableColumn<LibvirtNetworkRow>[]>(
    () => [
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: (row) => row.state,
        renderCell: (row) => {
          const meta = getNetworkStateMeta(row.state);
          return <span className={`status-pill status-pill--${meta.intent}`}>{meta.label}</span>;
        },
      },
      {
        id: "name",
        label: "Network",
        sortable: true,
        sortAccessor: (row) => row.name,
        renderCell: (row) => <Link to={`/networking/networks/${encodeURIComponent(row.id)}`}>{row.name}</Link>,
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
        id: "description",
        label: "Description",
        sortable: true,
        sortAccessor: (row) => row.description ?? "",
        renderCell: (row) => row.description ?? "--",
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["state", "name", "forward", "bridge", "shared", "description"],
    storageKey: "network-libvirt-columns",
    initialSort: { columnId: "name", direction: "asc" },
  });

  if (isLoading) return <div className="panel__status">Loading libvirt networks…</div>;
  if (error) return <div className="panel__status panel__status--error">{error}</div>;
  if (!rows.length) return <div className="panel__status">No libvirt networks reported.</div>;

  return (
    <>
      <div className="table-wrapper">
        <table className="hosts-table hosts-table--metrics">
          <thead>
            <tr>
              {table.visibleColumns.map((column) => {
                const isSorted = table.sortState?.columnId === column.id;
                const ariaSort = isSorted
                  ? table.sortState?.direction === "asc"
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
                        onClick={() => table.requestSort(column.id)}
                      >
                        {column.label}
                        <span className="table-header-button__icon">
                          {isSorted ? (table.sortState?.direction === "asc" ? "▲" : "▼") : "↕"}
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
                  columns={columns}
                  visibleColumnIds={table.visibleColumnIds}
                  toggleColumn={table.toggleColumn}
                  canToggleColumn={table.canToggleColumn}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {table.sortedRows.map((row) => (
              <tr key={row.id}>
                {table.visibleColumns.map((column) => (
                  <td key={column.id}>{column.renderCell(row)}</td>
                ))}
                <td className="table-gear-cell" aria-hidden="true" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {attention.length > 0 && (
        <div className="panel__status panel__status--warning">
          <strong>Attention required:</strong>
          <ul className="attention-list">
            {attention.map((network) => (
              <li key={network.id}>
                <span className="attention-list__name">{network.name}</span>
                {": "}
                {network.hosts.length > 0
                  ? network.hosts
                      .map((host) => {
                        const display = host.display_name ?? host.hostname ?? "unknown host";
                        const status = host.status ? host.status.replace(/_/g, " ") : "unknown";
                        const message = host.message ? ` (${host.message})` : "";
                        return `${display} – ${status}${message}`;
                      })
                      .join(", ")
                  : "No hosts currently reporting this network"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
