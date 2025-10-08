import { Link, useParams } from "react-router-dom";
import { useStorageVolumeDetails } from "../hooks/useStorageVolumeDetails";
import { formatBytes } from "../utils/formatters";
import { getVolumeStateMeta } from "../utils/storage";

export function StorageVolumeDetailsPage() {
  const params = useParams<{ hostname?: string; pool?: string; volume?: string }>();
  const hostname = decodeURIComponent(params.hostname ?? "");
  const poolName = decodeURIComponent(params.pool ?? "");
  const volumeName = decodeURIComponent(params.volume ?? "");

  const { data, isLoading, error, refresh } = useStorageVolumeDetails(hostname, poolName, volumeName);
  const volume = data?.volume;
  const pool = data?.pool;
  const attachedDomains = data?.attached_domains ?? [];
  const stateMeta = getVolumeStateMeta(volume?.state);

  const capacity = formatBytes(volume?.capacity_bytes ?? null);
  const allocation = formatBytes(volume?.allocation_bytes ?? null);
  const available = formatBytes(volume?.available_bytes ?? null);

  const hostLink = hostname ? (
    <Link to={`/physical-hosts/${encodeURIComponent(hostname)}`}>{hostname}</Link>
  ) : (
    <span>--</span>
  );

  return (
    <div className="page-stack" data-page="storage-volume-details">
      <header className="page-header">
        <div>
          <h1>{volumeName || "Storage Volume"}</h1>
          <p className="page-header__subtitle">
            Volume metadata for pool <Link to="/storage">{poolName || "--"}</Link> on host {hostLink}.
          </p>
        </div>
        <div className="page-header__actions">
          <Link className="link-button" to="/storage">
            ← Back to Storage Overview
          </Link>
          <button type="button" className="refresh-button" onClick={refresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Volume Summary</h2>
          <p className="panel__subtitle">Live data reported by libvirt.</p>
        </header>
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {isLoading && <div className="panel__status">Loading volume details…</div>}
        {!isLoading && !error && !data && <div className="panel__status">No volume details available.</div>}
        {data && (
          <>
            <div className="summary-grid">
              <div className="summary-grid__item">
                <div className="summary-grid__label">State</div>
                <div className="summary-grid__value">
                  <span className={`status-pill status-pill--${stateMeta.intent}`}>{stateMeta.label}</span>
                </div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Capacity</div>
                <div className="summary-grid__value">{capacity}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Allocation</div>
                <div className="summary-grid__value">{allocation}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Available</div>
                <div className="summary-grid__value">{available}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Type</div>
                <div className="summary-grid__value">{volume?.type ?? "--"}</div>
              </div>
              <div className="summary-grid__item">
                <div className="summary-grid__label">Format</div>
                <div className="summary-grid__value">{volume?.format ?? "--"}</div>
              </div>
            </div>

            <dl className="definition-list definition-list--compact">
              <div className="definition-list__item">
                <dt>Path</dt>
                <dd className="summary-grid__value--mono">{volume?.path ?? "--"}</dd>
              </div>
              <div className="definition-list__item">
                <dt>Key</dt>
                <dd className="summary-grid__value--mono">{volume?.key ?? "--"}</dd>
              </div>
              <div className="definition-list__item">
                <dt>Backing Store</dt>
                <dd className="summary-grid__value--mono">{volume?.backing_store ?? "--"}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {pool && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Storage Pool</h2>
            <p className="panel__subtitle">Current state of pool {pool.name}.</p>
          </header>
          <div className="summary-grid">
            <div className="summary-grid__item">
              <div className="summary-grid__label">State</div>
              <div className="summary-grid__value">{pool.state ?? "--"}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Persistent</div>
              <div className="summary-grid__value">{pool.persistent === undefined ? "--" : pool.persistent ? "Yes" : "No"}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Autostart</div>
              <div className="summary-grid__value">{pool.autostart === undefined ? "--" : pool.autostart ? "Yes" : "No"}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Capacity</div>
              <div className="summary-grid__value">{formatBytes(pool.capacity_bytes ?? null)}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Allocation</div>
              <div className="summary-grid__value">{formatBytes(pool.allocation_bytes ?? null)}</div>
            </div>
            <div className="summary-grid__item">
              <div className="summary-grid__label">Available</div>
              <div className="summary-grid__value">{formatBytes(pool.available_bytes ?? null)}</div>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Attached Domains</h2>
          <p className="panel__subtitle">Domains currently using this volume.</p>
        </header>
        {attachedDomains.length === 0 && (
          <div className="panel__status">No running domains are using this volume.</div>
        )}
        {attachedDomains.length > 0 && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                </tr>
              </thead>
              <tbody>
                {attachedDomains.map((domain) => (
                  <tr key={domain}>
                    <td>
                      <Link to={`/guest-hosts/${encodeURIComponent(hostname)}/${encodeURIComponent(domain)}`}>
                        {domain}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data?.xml && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Volume XML</h2>
            <p className="panel__subtitle">Raw libvirt XML description. Hidden by default.</p>
          </header>
          <details>
            <summary className="link-button">Show XML</summary>
            <pre className="code-block">{data.xml}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
