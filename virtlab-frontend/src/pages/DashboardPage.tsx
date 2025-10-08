import { useMemo } from "react";
import { StatsBanner, type StatItem } from "../components.StatsBanner";
import { useClusterNetworks } from "../hooks/useClusterNetworks";
import { useClusterStorage } from "../hooks/useClusterStorage";
import { useClusterVms } from "../hooks/useClusterVms";
import type { HostInfo } from "../types";
import { formatConnectionType } from "../utils/formatters";

type DashboardPageProps = {
  hosts: HostInfo[];
  isLoading: boolean;
  error: string | null;
};

type HostStatusRow = {
  host: string;
  status: "ok" | "warning" | "error";
  statusLabel: string;
  networks: string;
  connection: string;
  detail: string;
};

const VM_ONLINE_STATES = new Set(["running", "blocked"]);
const VM_FAILED_STATES = new Set(["crashed"]);

export function DashboardPage({ hosts, isLoading, error }: DashboardPageProps) {
  const {
    hosts: networkInventories,
    isLoading: isLoadingNetworks,
    error: networksError,
    errors: perHostErrors,
  } = useClusterNetworks();
  const {
    hosts: storageInventories,
    isLoading: isLoadingStorage,
    error: storageError,
  } = useClusterStorage();
  const {
    hosts: vmInventories,
    isLoading: isLoadingVms,
    error: vmsError,
  } = useClusterVms();

  const connectionByHost = useMemo(() => {
    const map = new Map<string, string>();
    hosts.forEach((host) => {
      map.set(host.hostname, formatConnectionType(host.uri));
    });
    return map;
  }, [hosts]);

  const libvirtNetworkStats = useMemo(
    () =>
      Object.values(networkInventories).reduce(
        (acc, inventory) => {
          inventory.networks?.forEach((network) => {
            if (network.active) {
              acc.online += 1;
            } else {
              acc.down += 1;
            }
          });
          return acc;
        },
        { online: 0, down: 0 },
      ),
    [networkInventories],
  );

  const storageDomainStats = useMemo(
    () =>
      Object.values(storageInventories).reduce(
        (acc, inventory) => {
          inventory.pools.forEach((pool) => {
            const state = (pool.state ?? "").toLowerCase();
            if (state === "running") {
              acc.online += 1;
            } else {
              acc.down += 1;
            }
          });
          return acc;
        },
        { online: 0, down: 0 },
      ),
    [storageInventories],
  );

  const vmCounts = useMemo(() => {
    return Object.values(vmInventories).reduce(
      (acc, inventory) => {
        inventory.vms.forEach((vm) => {
          const state = (vm.state ?? "").toLowerCase();
          if (VM_ONLINE_STATES.has(state)) {
            acc.online += 1;
          } else if (VM_FAILED_STATES.has(state)) {
            acc.failed += 1;
          } else {
            acc.stopped += 1;
          }
          acc.total += 1;
        });
        return acc;
      },
      { online: 0, stopped: 0, failed: 0, total: 0 },
    );
  }, [vmInventories]);

  const virtualNodesValue = isLoadingVms
    ? "..."
    : vmsError
      ? "--"
      : String(vmCounts.online);

  const virtualNodesMeta = isLoadingVms || vmsError
    ? undefined
    : `Stopped: ${vmCounts.stopped} · Failed: ${vmCounts.failed}`;

  const libvirtNetworksValue = isLoadingNetworks
    ? "..."
    : networksError
      ? "--"
      : String(libvirtNetworkStats.online);

  const storageDomainsValue = isLoadingStorage
    ? "..."
    : storageError
      ? "--"
      : String(storageDomainStats.online);

  const libvirtNetworksMeta = useMemo(() => {
    if (isLoadingNetworks || networksError) return undefined;
    const inventoryIssues = Object.values(networkInventories).filter(
      (inventory) => (inventory.errors?.length ?? 0) > 0,
    ).length;
    const connectionFailures = Object.keys(perHostErrors ?? {}).length;
    const totalIssues = inventoryIssues + connectionFailures;
    return `Down: ${libvirtNetworkStats.down} · Error: ${totalIssues}`;
  }, [isLoadingNetworks, libvirtNetworkStats.down, networkInventories, networksError, perHostErrors]);

  const storageDomainsMeta = useMemo(() => {
    if (isLoadingStorage || storageError) return undefined;
    const issueHosts = Object.values(storageInventories).filter(
      (inventory) => (inventory.errors?.length ?? 0) > 0,
    ).length;
    return `Down: ${storageDomainStats.down} · Error: ${issueHosts}`;
  }, [isLoadingStorage, storageDomainStats.down, storageError, storageInventories]);

  const statusRows: HostStatusRow[] = useMemo(() => {
    const rows = new Map<string, HostStatusRow>();

    hosts.forEach((host) => {
      const inventory = networkInventories[host.hostname];
      const networkCount = inventory?.networks?.length ?? 0;
      rows.set(host.hostname, {
        host: host.hostname,
        status: "ok",
        statusLabel: "Info available",
        networks: inventory ? String(networkCount) : "--",
        connection: connectionByHost.get(host.hostname) ?? "--",
        detail:
          inventory && networkCount > 0
            ? networkCount === 1
              ? "1 network available"
              : `${networkCount} networks available`
            : "Awaiting network inventory",
      });
    });

    Object.entries(networkInventories).forEach(([host, inventory]) => {
      const networkCount = inventory.networks?.length ?? 0;
      const hasInventoryErrors = (inventory.errors?.length ?? 0) > 0;
      const base = rows.get(host) ?? {
        host,
        connection: connectionByHost.get(host) ?? "--",
        status: "ok" as const,
        statusLabel: "Connected",
        networks: "--",
        detail: "",
      };
      const detail = hasInventoryErrors
        ? inventory.errors!.join("; ")
        : networkCount === 0
          ? "No networks reported"
          : networkCount === 1
            ? "1 network available"
            : `${networkCount} networks available`;

      rows.set(host, {
        ...base,
        status: hasInventoryErrors ? "warning" : "ok",
        statusLabel: hasInventoryErrors ? "Partial" : "Connected",
        networks: String(networkCount),
        detail,
      });
    });

    Object.entries(perHostErrors ?? {}).forEach(([host, message]) => {
      rows.set(host, {
        host,
        status: "error",
        statusLabel: "Error",
        networks: "--",
        connection: connectionByHost.get(host) ?? "--",
        detail: message,
      });
    });

    return Array.from(rows.values()).sort((a, b) => a.host.localeCompare(b.host));
  }, [hosts, connectionByHost, networkInventories, perHostErrors]);

  const physicalStatusCounts = useMemo(
    () =>
      statusRows.reduce(
        (acc, row) => {
          if (row.status === "ok") {
            acc.running += 1;
          } else if (row.status === "warning") {
            acc.offline += 1;
          } else {
            acc.error += 1;
          }
          return acc;
        },
        { running: 0, offline: 0, error: 0 },
      ),
    [statusRows],
  );

  const physicalNodesValue = isLoading
    ? "..."
    : error
      ? "--"
      : String(physicalStatusCounts.running);

  const physicalNodesMeta = isLoading || error
    ? undefined
    : `Offline: ${physicalStatusCounts.offline} · Error: ${physicalStatusCounts.error}`;

  const stats: StatItem[] = useMemo(
    () => [
      {
        label: "Physical Nodes Online",
        value: physicalNodesValue,
        meta: physicalNodesMeta,
      },
      {
        label: "Virtual Nodes Online",
        value: virtualNodesValue,
        meta: virtualNodesMeta,
      },
      {
        label: "Libvirt Networks Online",
        value: libvirtNetworksValue,
        meta: libvirtNetworksMeta,
      },
      {
        label: "Storage Domains Online",
        value: storageDomainsValue,
        meta: storageDomainsMeta,
      },
    ],
    [
      libvirtNetworksMeta,
      libvirtNetworksValue,
      physicalNodesMeta,
      physicalNodesValue,
      storageDomainsMeta,
      storageDomainsValue,
      virtualNodesMeta,
      virtualNodesValue,
    ],
  );

  return (
    <div className="page-stack" data-page="dashboard">
      <StatsBanner stats={stats} />

      <section className="panel" aria-label="Host connectivity">
        <header className="panel__header">
          <h2 className="panel__title">Host Connectivity</h2>
          <p className="panel__subtitle">Status derived from host inventory and libvirt network checks.</p>
        </header>

        {isLoading && <div className="panel__status">Loading host inventory…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {isLoadingNetworks && <div className="panel__status">Checking connectivity…</div>}
        {networksError && !isLoadingNetworks && (
          <div className="panel__status panel__status--error">{networksError}</div>
        )}

        {!isLoadingNetworks && !networksError && statusRows.length === 0 && (
          <div className="panel__status">No host inventory available yet.</div>
        )}

        {statusRows.length > 0 && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Networks</th>
                  <th>Connection</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.host}>
                    <td>{row.host}</td>
                    <td>
                      <span className={`status status--${row.status}`}>{row.statusLabel}</span>
                    </td>
                    <td>{row.networks}</td>
                    <td>{row.connection}</td>
                    <td>{row.detail}</td>
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
