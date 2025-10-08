import { Link, useParams } from "react-router-dom";
import { useHostDetails } from "../hooks/useHostDetails";
import { classifyVmState } from "../utils/vm";
import { formatDuration, formatMemory, formatPercent } from "../utils/formatters";

export function PhysicalHostDetailsPage() {
  const params = useParams<{ hostname?: string }>();
  const hostname = decodeURIComponent(params.hostname ?? "");

  const { details, isLoading, error, refresh } = useHostDetails(hostname);

  const cpuMetrics = details?.metrics?.cpu;
  const memoryMetrics = details?.metrics?.memory;
  const guests = details?.guests ?? [];

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
          <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="panel">
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
        <section className="panel">
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

      {guests.length > 0 && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Assigned Guest Hosts</h2>
            <p className="panel__subtitle">Domains currently reported on this physical host.</p>
          </header>
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>vCPUs</th>
                  <th>Memory</th>
                  <th>Uptime</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((vm) => {
                  const { label, intent } = classifyVmState(vm.state);
                  return (
                    <tr key={vm.name}>
                      <td>
                        <Link to={`/guest-hosts/${encodeURIComponent(hostname)}/${encodeURIComponent(vm.name)}`}>
                          {vm.name}
                        </Link>
                      </td>
                      <td>
                        <span className={`status-pill status-pill--${intent}`}>{label}</span>
                      </td>
                      <td>{vm.metrics?.vcpu_count ?? "--"}</td>
                      <td>{vm.metrics?.memory_mb != null ? formatMemory(vm.metrics.memory_mb) : "--"}</td>
                      <td>{vm.metrics?.uptime_seconds != null ? formatDuration(vm.metrics.uptime_seconds) : "--"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
