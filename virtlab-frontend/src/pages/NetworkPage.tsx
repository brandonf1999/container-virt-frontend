import { useMemo, useState } from "react";
import { useClusterNetworks } from "../hooks/useClusterNetworks";
import type { HostNetworkInventory, NetworkInterface } from "../types";
import { formatBytes, formatInterfaceAddress, formatSpeedMbps } from "../utils/formatters";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";

type TableView = "overview" | "libvirt" | "bonds" | "bridges" | "vlans" | "physical";

type BondRow = {
  host: string;
  name: string;
  mode?: string | null;
  slaves: string[];
  miimon?: string | null;
  active: boolean;
};

type BridgeRow = {
  host: string;
  name: string;
  bridgeName?: string | null;
  stp?: string | null;
  delay?: string | null;
  active: boolean;
};

type VlanRow = {
  host: string;
  name: string;
  vlanId?: string | null;
  trunk: boolean;
  tags: string[];
  active: boolean;
};

type LibvirtNetworkRow = {
  host: string;
  name: string;
  bridge?: string | null;
  forward: string;
  active: boolean;
  autostart: boolean;
  addresses: string[];
  dhcp: string[];
};

type PhysicalInterfaceRow = {
  host: string;
  iface: NetworkInterface;
};

type HostSummary = {
  host: string;
  interfaces: number;
  physical: number;
  bonds: number;
  bridges: number;
  vlans: number;
  networks: number;
  hasInventoryErrors: boolean;
};

const TABLE_OPTIONS: Array<{ id: TableView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "libvirt", label: "Libvirt Networks" },
  { id: "bonds", label: "Bonded Interfaces" },
  { id: "bridges", label: "Network Bridges" },
  { id: "vlans", label: "VLAN Interfaces" },
  { id: "physical", label: "Physical Interfaces" },
];

function renderAddresses(iface: NetworkInterface) {
  const formatted = iface.addresses
    .map((addr) => formatInterfaceAddress(addr))
    .filter(Boolean) as string[];
  return formatted.length ? formatted.join("\n") : "--";
}

function renderLinkDetails(iface: NetworkInterface) {
  const { link } = iface;
  if (!link) return "--";
  const state = link.state ? link.state.toUpperCase() : null;
  const speed = formatSpeedMbps(link.speed_mbps ?? undefined, link.speed ?? null);
  return [state, speed].filter(Boolean).join(" · ") || "--";
}

function renderStats(iface: NetworkInterface) {
  if (!iface.stats) return "--";
  const rx = formatBytes(iface.stats.rx_bytes);
  const tx = formatBytes(iface.stats.tx_bytes);
  return `RX ${rx} / TX ${tx}`;
}

function BondsTable({ rows }: { rows: BondRow[] }) {
  const columns = useMemo<TableColumn<BondRow>[]>(
    () => [
      { id: "host", label: "Host", sortable: true, sortAccessor: (row) => row.host, renderCell: (row) => row.host },
      { id: "bond", label: "Bond", sortable: true, sortAccessor: (row) => row.name, renderCell: (row) => row.name },
      { id: "mode", label: "Mode", sortable: true, sortAccessor: (row) => row.mode ?? "", renderCell: (row) => row.mode ?? "--" },
      {
        id: "slaves",
        label: "Members",
        sortable: true,
        sortAccessor: (row) => row.slaves.join(", "),
        renderCell: (row) => (row.slaves.length ? row.slaves.join(", ") : "--"),
      },
      { id: "miimon", label: "Miimon", sortable: true, sortAccessor: (row) => row.miimon ?? "", renderCell: (row) => row.miimon ?? "--" },
      {
        id: "active",
        label: "Active",
        sortable: true,
        sortAccessor: (row) => (row.active ? 1 : 0),
        renderCell: (row) => (row.active ? "Yes" : "No"),
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "bond", "mode", "slaves", "miimon", "active"],
    storageKey: "network-bonds-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No bonded interfaces reported.</div>;
  }

  return (
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
            <tr key={`${row.host}:${row.name}`}>
              {table.visibleColumns.map((column) => (
                <td key={column.id}>{column.renderCell(row)}</td>
              ))}
              <td className="table-gear-cell" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BridgesTable({ rows }: { rows: BridgeRow[] }) {
  const columns = useMemo<TableColumn<BridgeRow>[]>(
    () => [
      { id: "host", label: "Host", sortable: true, sortAccessor: (row) => row.host, renderCell: (row) => row.host },
      { id: "name", label: "Interface", sortable: true, sortAccessor: (row) => row.name, renderCell: (row) => row.name },
      {
        id: "bridgeName",
        label: "Bridge Name",
        sortable: true,
        sortAccessor: (row) => row.bridgeName ?? "",
        renderCell: (row) => row.bridgeName ?? "--",
      },
      { id: "stp", label: "STP", sortable: true, sortAccessor: (row) => row.stp ?? "", renderCell: (row) => row.stp ?? "--" },
      { id: "delay", label: "Delay", sortable: true, sortAccessor: (row) => row.delay ?? "", renderCell: (row) => row.delay ?? "--" },
      {
        id: "active",
        label: "Active",
        sortable: true,
        sortAccessor: (row) => (row.active ? 1 : 0),
        renderCell: (row) => (row.active ? "Yes" : "No"),
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "name", "bridgeName", "stp", "delay", "active"],
    storageKey: "network-bridges-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No bridges defined.</div>;
  }

  return (
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
            <tr key={`${row.host}:${row.name}`}>
              {table.visibleColumns.map((column) => (
                <td key={column.id}>{column.renderCell(row)}</td>
              ))}
              <td className="table-gear-cell" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VlansTable({ rows }: { rows: VlanRow[] }) {
  const columns = useMemo<TableColumn<VlanRow>[]>(
    () => [
      { id: "host", label: "Host", sortable: true, sortAccessor: (row) => row.host, renderCell: (row) => row.host },
      { id: "name", label: "Interface", sortable: true, sortAccessor: (row) => row.name, renderCell: (row) => row.name },
      {
        id: "vlanId",
        label: "VLAN ID",
        sortable: true,
        sortAccessor: (row) => row.vlanId ?? "",
        renderCell: (row) => row.vlanId ?? "--",
      },
      {
        id: "trunk",
        label: "Trunk",
        sortable: true,
        sortAccessor: (row) => (row.trunk ? 1 : 0),
        renderCell: (row) => (row.trunk ? "Yes" : "No"),
      },
      {
        id: "tags",
        label: "Tags",
        sortable: true,
        sortAccessor: (row) => row.tags.join(", "),
        renderCell: (row) => (row.tags.length ? row.tags.join(", ") : "--"),
      },
      {
        id: "active",
        label: "Active",
        sortable: true,
        sortAccessor: (row) => (row.active ? 1 : 0),
        renderCell: (row) => (row.active ? "Yes" : "No"),
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "name", "vlanId", "trunk", "tags", "active"],
    storageKey: "network-vlans-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No VLAN interfaces reported.</div>;
  }

  return (
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
            <tr key={`${row.host}:${row.name}`}>
              {table.visibleColumns.map((column) => (
                <td key={column.id}>{column.renderCell(row)}</td>
              ))}
              <td className="table-gear-cell" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhysicalInterfacesTable({ rows }: { rows: PhysicalInterfaceRow[] }) {
  const columns = useMemo<TableColumn<PhysicalInterfaceRow>[]>(
    () => [
      { id: "host", label: "Host", sortable: true, sortAccessor: (row) => row.host, renderCell: (row) => row.host },
      { id: "name", label: "Interface", sortable: true, sortAccessor: (row) => row.iface.name, renderCell: (row) => row.iface.name },
      { id: "mac", label: "MAC", sortable: true, sortAccessor: (row) => row.iface.mac ?? "", renderCell: (row) => row.iface.mac ?? "--" },
      {
        id: "addresses",
        label: "Addresses",
        sortable: true,
        sortAccessor: (row) => renderAddresses(row.iface),
        renderCell: (row) => <pre className="inline-pre">{renderAddresses(row.iface)}</pre>,
      },
      {
        id: "link",
        label: "Link",
        sortable: true,
        sortAccessor: (row) => renderLinkDetails(row.iface),
        renderCell: (row) => renderLinkDetails(row.iface),
      },
      { id: "mtu", label: "MTU", sortable: true, sortAccessor: (row) => row.iface.mtu ?? null, renderCell: (row) => row.iface.mtu ?? "--" },
      {
        id: "start",
        label: "Start",
        sortable: true,
        sortAccessor: (row) => row.iface.start_mode ?? "",
        renderCell: (row) => row.iface.start_mode ?? "--",
      },
      {
        id: "stats",
        label: "Stats",
        sortable: true,
        sortAccessor: (row) => renderStats(row.iface),
        renderCell: (row) => renderStats(row.iface),
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "name", "mac", "addresses", "link", "mtu", "start", "stats"],
    storageKey: "network-physical-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No standalone physical interfaces reported.</div>;
  }

  return (
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
            <tr key={`${row.host}:${row.iface.name}`}>
              {table.visibleColumns.map((column) => (
                <td key={column.id}>{column.renderCell(row)}</td>
              ))}
              <td className="table-gear-cell" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LibvirtNetworksTable({ rows }: { rows: LibvirtNetworkRow[] }) {
  const columns = useMemo<TableColumn<LibvirtNetworkRow>[]>(
    () => [
      { id: "host", label: "Host", sortable: true, sortAccessor: (row) => row.host, renderCell: (row) => row.host },
      { id: "name", label: "Network", sortable: true, sortAccessor: (row) => row.name, renderCell: (row) => row.name },
      { id: "bridge", label: "Bridge", sortable: true, sortAccessor: (row) => row.bridge ?? "", renderCell: (row) => row.bridge ?? "--" },
      { id: "forward", label: "Forward", sortable: true, sortAccessor: (row) => row.forward, renderCell: (row) => row.forward },
      { id: "active", label: "Active", sortable: true, sortAccessor: (row) => (row.active ? 1 : 0), renderCell: (row) => (row.active ? "Yes" : "No") },
      { id: "autostart", label: "Autostart", sortable: true, sortAccessor: (row) => (row.autostart ? 1 : 0), renderCell: (row) => (row.autostart ? "Yes" : "No") },
      {
        id: "addresses",
        label: "Addresses",
        sortable: true,
        sortAccessor: (row) => row.addresses.join(", "),
        renderCell: (row) => (row.addresses.length ? <pre className="inline-pre">{row.addresses.join("\n")}</pre> : "--"),
      },
      {
        id: "dhcp",
        label: "DHCP",
        sortable: true,
        sortAccessor: (row) => row.dhcp.join(", "),
        renderCell: (row) => (row.dhcp.length ? <pre className="inline-pre">{row.dhcp.join("\n")}</pre> : "--"),
      },
    ],
    [],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "name", "bridge", "forward", "active", "autostart", "addresses", "dhcp"],
    storageKey: "network-libvirt-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No libvirt networks reported.</div>;
  }

  return (
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
            <tr key={`${row.host}:${row.name}`}>
              {table.visibleColumns.map((column) => (
                <td key={column.id}>{column.renderCell(row)}</td>
              ))}
              <td className="table-gear-cell" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhysicalHostTable({
  rows,
  onRowClick,
  hostErrors,
}: {
  rows: HostSummary[];
  onRowClick: (host: string) => void;
  hostErrors: Record<string, string> | undefined;
}) {
  const columns = useMemo<TableColumn<HostSummary>[]>(
    () => [
      {
        id: "host",
        label: "Host",
        sortable: true,
        sortAccessor: (row) => row.host,
        renderCell: (row) => row.host,
      },
      {
        id: "interfaces",
        label: "Interfaces",
        sortable: true,
        sortAccessor: (row) => row.interfaces,
        renderCell: (row) => row.interfaces,
      },
      {
        id: "physical",
        label: "Physical",
        sortable: true,
        sortAccessor: (row) => row.physical,
        renderCell: (row) => row.physical,
      },
      {
        id: "bonds",
        label: "Bonds",
        sortable: true,
        sortAccessor: (row) => row.bonds,
        renderCell: (row) => row.bonds,
      },
      {
        id: "bridges",
        label: "Bridges",
        sortable: true,
        sortAccessor: (row) => row.bridges,
        renderCell: (row) => row.bridges,
      },
      {
        id: "vlans",
        label: "VLANs",
        sortable: true,
        sortAccessor: (row) => row.vlans,
        renderCell: (row) => row.vlans,
      },
      {
        id: "networks",
        label: "Libvirt Networks",
        sortable: true,
        sortAccessor: (row) => row.networks,
        renderCell: (row) => row.networks,
      },
      {
        id: "status",
        label: "Status",
        sortable: true,
        sortAccessor: (row) => (hostErrors?.[row.host] ? 3 : row.hasInventoryErrors ? 2 : 1),
        renderCell: (row) => {
          const errorMessage = hostErrors?.[row.host];
          return errorMessage ? (
            <span className="status status--error">Error</span>
          ) : row.hasInventoryErrors ? (
            <span className="status status--warning">Partial</span>
          ) : (
            <span className="status status--ok">OK</span>
          );
        },
      },
    ],
    [hostErrors],
  );

  const table = useTableState(columns, rows, {
    defaultVisible: ["host", "interfaces", "physical", "bonds", "bridges", "vlans", "networks", "status"],
    storageKey: "network-hosts-columns",
    initialSort: { columnId: "host", direction: "asc" },
  });

  if (!rows.length) {
    return <div className="panel__status">No hosts reporting network data.</div>;
  }

  return (
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
          {table.sortedRows.map((row) => {
            return (
              <tr
                key={row.host}
                className="table-row--clickable"
                onClick={() => onRowClick(row.host)}
              >
                {table.visibleColumns.map((column) => (
                  <td key={column.id}>{column.renderCell(row)}</td>
                ))}
                <td className="table-gear-cell" aria-hidden="true" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PhysicalInterfacesModal({
  host,
  inventory,
  onClose,
}: {
  host: string;
  inventory: HostNetworkInventory;
  onClose: () => void;
}) {
  const physicalInterfaces = useMemo(
    () =>
      (inventory.interfaces ?? []).filter(
        (iface) => !iface.bond && !iface.bridge,
      ),
    [inventory.interfaces],
  );

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Physical interfaces for ${host}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2>Physical interfaces · {host}</h2>
            <p>Click outside or press Esc to close.</p>
          </div>
          <button type="button" className="modal__close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal__body">
          {physicalInterfaces.length === 0 ? (
            <div className="panel__status">No standalone physical interfaces reported.</div>
          ) : (
            <div className="table-wrapper">
              <table className="hosts-table hosts-table--metrics">
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>MAC</th>
                    <th>Addresses</th>
                    <th>Link</th>
                    <th>MTU</th>
                    <th>Start</th>
                    <th>Stats</th>
                  </tr>
                </thead>
                <tbody>
                  {physicalInterfaces.map((iface) => (
                    <tr key={iface.name}>
                      <td>{iface.name}</td>
                      <td>{iface.mac ?? "--"}</td>
                      <td>
                        <pre className="inline-pre">{renderAddresses(iface)}</pre>
                      </td>
                      <td>{renderLinkDetails(iface)}</td>
                      <td>{iface.mtu ?? "--"}</td>
                      <td>{iface.start_mode ?? "--"}</td>
                      <td>{renderStats(iface)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NetworkPage() {
  const { hosts, errors, summary, isLoading, error, refresh } = useClusterNetworks();
  const [selectedTable, setSelectedTable] = useState<TableView>("overview");
  const [activeHost, setActiveHost] = useState<string | null>(null);

  const hostEntries = useMemo(() => Object.entries(hosts), [hosts]);

  const aggregates = useMemo(() => {
    const bondRows: BondRow[] = [];
    const bridgeRows: BridgeRow[] = [];
    const vlanRows: VlanRow[] = [];
    const libvirtRows: LibvirtNetworkRow[] = [];
    const physicalRows: PhysicalInterfaceRow[] = [];
    const summaries: HostSummary[] = [];

    hostEntries.forEach(([hostname, inventory]) => {
      const interfaces = inventory.interfaces ?? [];
      const networks = inventory.networks ?? [];

      let bondCount = 0;
      let bridgeCount = 0;
      let vlanCount = 0;
      let physicalCount = 0;

      interfaces.forEach((iface) => {
        const bond = (iface.bond as Record<string, unknown> | null) ?? undefined;
        const bridge = (iface.bridge as Record<string, unknown> | null) ?? undefined;
        const vlan = (iface.vlan as Record<string, unknown> | null) ?? undefined;

        if (bond) {
          bondCount += 1;
          const slavesRaw = bond.slaves as unknown;
          const mode = typeof bond.mode === "string" ? (bond.mode as string) : undefined;
          const miimon = typeof bond.miimon === "string" ? (bond.miimon as string) : undefined;
          const slaveNames = Array.isArray(slavesRaw)
            ? (slavesRaw as Array<{ name?: string | null }>)
                .map((slave) => slave?.name)
                .filter((name): name is string => typeof name === "string" && name.length > 0)
            : [];
          bondRows.push({
            host: hostname,
            name: iface.name,
            mode,
            slaves: slaveNames,
            miimon,
            active: !!iface.active,
          });
        }

        if (bridge) {
          bridgeCount += 1;
          bridgeRows.push({
            host: hostname,
            name: iface.name,
            bridgeName: typeof bridge.name === "string" ? (bridge.name as string) : undefined,
            stp: typeof bridge.stp === "string" ? (bridge.stp as string) : undefined,
            delay: typeof bridge.delay === "string" ? (bridge.delay as string) : undefined,
            active: !!iface.active,
          });
        }

        if (vlan) {
          vlanCount += 1;
          const vlanId = typeof vlan.id === "string" ? vlan.id : undefined;
          const tagsArray = Array.isArray(vlan.tags) ? (vlan.tags as Array<{ id?: string | null }>) : [];
          const tags = tagsArray
            .map((tag) => tag?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          const trunk =
            vlan.trunk === true || vlan.trunk === "yes" || vlan.trunk === "true" ? true : false;

          vlanRows.push({
            host: hostname,
            name: iface.name,
            vlanId,
            trunk,
            tags,
            active: !!iface.active,
          });
        }

        if (!bond && !bridge) {
          physicalCount += 1;
          physicalRows.push({ host: hostname, iface });
        }
      });

      summaries.push({
        host: hostname,
        interfaces: interfaces.length,
        physical: physicalCount,
        bonds: bondCount,
        bridges: bridgeCount,
        vlans: vlanCount,
        networks: networks.length,
        hasInventoryErrors: (inventory.errors?.length ?? 0) > 0,
      });

      networks.forEach((net) => {
        const forwardMode = net.forward_mode ?? "--";
        const forwardDev = net.forward_dev ? ` → ${net.forward_dev}` : "";
        const addresses = net.ips
          .map((ip) => formatInterfaceAddress({ address: ip.address, prefix: ip.prefix }))
          .filter(Boolean) as string[];
        const dhcpRanges = net.dhcp
          .map((range) => `${range.start ?? "?"} → ${range.end ?? "?"}`)
          .filter(Boolean);

        const forward = `${forwardMode}${forwardDev}`.trim() || "--";
        const bridgeRecord = net.bridge as Record<string, unknown> | null | undefined;
        const bridgeName =
          bridgeRecord && typeof bridgeRecord.name === "string"
            ? (bridgeRecord.name as string)
            : undefined;

        libvirtRows.push({
          host: hostname,
          name: net.name,
          bridge: bridgeName,
          forward,
          active: net.active,
          autostart: net.autostart,
          addresses,
          dhcp: dhcpRanges,
        });
      });
    });

    bondRows.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
    bridgeRows.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
    vlanRows.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
    libvirtRows.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
    physicalRows.sort((a, b) => a.host.localeCompare(b.host) || a.iface.name.localeCompare(b.iface.name));
    summaries.sort((a, b) => a.host.localeCompare(b.host));

    return { bondRows, bridgeRows, vlanRows, libvirtRows, physicalRows, summaries };
  }, [hostEntries]);

  const missingHosts = useMemo(
    () => Object.keys(errors ?? {}).filter((hostname) => !hosts[hostname]),
    [errors, hosts],
  );

  const selectedHostInventory = activeHost ? hosts[activeHost] : undefined;

  return (
    <div className="page-stack" data-page="networking">
      <header className="page-header">
        <div>
          <h1>Networking</h1>
          <p className="page-header__subtitle">
            Explore bonded links, bridges, VLANs, and physical NICs across VirtLab hosts.
          </p>
        </div>
        <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <section className="panel__status panel__status--error">{error}</section>}

      {summary && (
        <section className="panel">
          <div className="panel__body-grid">
            <div>
              <div className="hosts-table__meta hosts-table__meta--muted">Hosts configured</div>
              <div className="stat-card__value">{summary.host_count}</div>
            </div>
            <div>
              <div className="hosts-table__meta hosts-table__meta--muted">Hosts reporting</div>
              <div className="stat-card__value">{summary.reported_hosts}</div>
            </div>
            <div>
              <div className="hosts-table__meta hosts-table__meta--muted">Hosts with errors</div>
              <div className="stat-card__value">{summary.failed_hosts}</div>
            </div>
          </div>
        </section>
      )}

      {missingHosts.length > 0 && (
        <section className="panel panel--warning">
          <div className="panel__status panel__status--error">
            Unable to collect network data for: {missingHosts.join(", ")}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="table-selector" role="tablist" aria-label="Network data views">
          {TABLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selectedTable === option.id}
              className={`table-selector__button${selectedTable === option.id ? " table-selector__button--active" : ""}`}
              onClick={() => setSelectedTable(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {selectedTable === "overview" && (
          <>
            <p className="table-hint">Click a host row to inspect its standalone physical NICs.</p>
            <PhysicalHostTable rows={aggregates.summaries} onRowClick={setActiveHost} hostErrors={errors} />
          </>
        )}
        {selectedTable === "libvirt" && <LibvirtNetworksTable rows={aggregates.libvirtRows} />}
        {selectedTable === "bonds" && <BondsTable rows={aggregates.bondRows} />}
        {selectedTable === "bridges" && <BridgesTable rows={aggregates.bridgeRows} />}
        {selectedTable === "vlans" && <VlansTable rows={aggregates.vlanRows} />}
        {selectedTable === "physical" && <PhysicalInterfacesTable rows={aggregates.physicalRows} />}
      </section>

      {selectedTable === "overview" && activeHost && selectedHostInventory && (
        <PhysicalInterfacesModal
          host={activeHost}
          inventory={selectedHostInventory}
          onClose={() => setActiveHost(null)}
        />
      )}
    </div>
  );
}
