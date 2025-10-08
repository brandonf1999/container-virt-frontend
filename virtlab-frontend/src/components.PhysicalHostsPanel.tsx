import type { HostInfo } from "./types";
import { formatConnectionType, formatMemory } from "./utils/formatters";

type PhysicalHostsPanelProps = {
  hosts: HostInfo[];
  isLoading: boolean;
  error: string | null;
};

export function PhysicalHostsPanel({ hosts, isLoading, error }: PhysicalHostsPanelProps) {
  const hasHosts = hosts.length > 0;

  return (
    <section className="panel" id="physical-hosts" aria-labelledby="physical-hosts-title">
      <header className="panel__header">
        <h2 className="panel__title" id="physical-hosts-title">
          Physical Hosts
        </h2>
        <p className="panel__subtitle">Live view from cluster info endpoint</p>
      </header>

      {isLoading && <div className="panel__status">Loading hosts…</div>}
      {error && !isLoading && (
        <div className="panel__status panel__status--error">{error}</div>
      )}
      {!isLoading && !error && !hasHosts && (
        <div className="panel__status">No hosts reported yet.</div>
      )}

      {!isLoading && !error && hasHosts && (
        <div className="table-wrapper">
          <table className="hosts-table">
            <thead>
              <tr>
                <th scope="col">Hostname</th>
                <th scope="col">Memory</th>
                <th scope="col">CPUs</th>
                <th scope="col">Architecture</th>
                <th scope="col">Connection</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr key={host.hostname}>
                  <td>{host.hostname}</td>
                  <td>{formatMemory(host.memory_MB)}</td>
                  <td>{host.cpus}</td>
                  <td>{host.arch}</td>
                  <td>{formatConnectionType(host.uri)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
