import type {
  ParseResult,
  HardwareServiceInfo,
  HardwareServicePort,
  HardwareServiceSession,
} from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function HardwareServicePanel({ result }: Props) {
  const { hardware_service } = result

  if (!hardware_service) {
    return (
      <div className="card panel-placeholder">No hardware service data available.</div>
    )
  }

  return (
    <div className="panel-stack">
      <StatusCard hs={hardware_service} />
      {hardware_service.ports.length > 0 && (
        <PortsCard ports={hardware_service.ports} />
      )}
      {hardware_service.timeline.length > 0 && (
        <TimelineCard timeline={hardware_service.timeline} />
      )}
      <DatabaseCard hs={hardware_service} />
      {hardware_service.hardware_cfg_entries.length > 0 && (
        <HardwareConfigCard entries={hardware_service.hardware_cfg_entries} />
      )}
    </div>
  )
}

/* ---- Status ---- */
function StatusCard({ hs }: { hs: HardwareServiceInfo }) {
  const running = hs.running
  const stateClass =
    running === true
      ? 'status-badge-large--running'
      : running === false
      ? 'status-badge-large--stopped'
      : 'status-badge-large--unknown'
  const stateLabel =
    running === true ? 'Running' : running === false ? 'Not Running' : 'Unknown'

  return (
    <section className="card">
      <h2 className="panel-heading">Service Status</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className={`status-badge-large ${stateClass}`}>{stateLabel}</span>
        {hs.service_startup_type && (
          <span className="badge badge-neutral">{hs.service_startup_type}</span>
        )}
      </div>
      <dl className="info-grid">
        {hs.version && (
          <>
            <dt className="info-label">Version</dt>
            <dd className="info-value">{hs.version}</dd>
          </>
        )}
        {hs.hal_version && (
          <>
            <dt className="info-label">HAL Version</dt>
            <dd className="info-value">{hs.hal_version}</dd>
          </>
        )}
        {hs.hal_branch && (
          <>
            <dt className="info-label">HAL Branch</dt>
            <dd className="info-value">{hs.hal_branch}</dd>
          </>
        )}
        {(hs.pid != null || hs.hal_pid) && (
          <>
            <dt className="info-label">PID</dt>
            <dd className="info-value">{hs.pid ?? hs.hal_pid}</dd>
          </>
        )}
        {hs.process_name && (
          <>
            <dt className="info-label">Process</dt>
            <dd className="info-value">{hs.process_name}</dd>
          </>
        )}
        {hs.install_path && (
          <>
            <dt className="info-label">Install Path</dt>
            <dd className="info-value"><code>{hs.install_path}</code></dd>
          </>
        )}
        {hs.grpc_status && (
          <>
            <dt className="info-label">gRPC Status</dt>
            <dd className="info-value">{hs.grpc_status}</dd>
          </>
        )}
        {hs.multiple_instances && (
          <>
            <dt className="info-label">Warning</dt>
            <dd className="info-value" style={{ color: 'var(--severity-warning)' }}>
              Multiple instances detected
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}

/* ---- Ports ---- */
function PortsCard({ ports }: { ports: HardwareServicePort[] }) {
  return (
    <section className="card">
      <h2 className="panel-heading">Ports ({ports.length})</h2>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Service</th>
              <th>Protocol</th>
              <th>Status</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((p, i) => (
              <PortRow key={i} port={p} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PortRow({ port }: { port: HardwareServicePort }) {
  const isListening = port.status.toLowerCase().includes('listen')
  const isBlocked = port.status.toLowerCase().includes('block') || port.status.toLowerCase().includes('closed')

  return (
    <tr>
      <td><code>{port.port}</code></td>
      <td>{port.service}</td>
      <td>{port.protocol}</td>
      <td className={isListening ? 'port-listening' : isBlocked ? 'port-blocked' : ''}>
        {port.status}
      </td>
      <td><code>{port.address}</code></td>
    </tr>
  )
}

/* ---- Timeline ---- */
function TimelineCard({ timeline }: { timeline: string[] }) {
  return (
    <section className="card">
      <h2 className="panel-heading">Timeline ({timeline.length} events)</h2>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {timeline.map((entry, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---- Database / Sessions ---- */
function DatabaseCard({ hs }: { hs: HardwareServiceInfo }) {
  const lastSessions = hs.sessions.slice(-5).reverse()

  return (
    <section className="card">
      <h2 className="panel-heading">Database</h2>

      {hs.db_version && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          DB Version: <code>{hs.db_version}</code>
          {hs.total_session_count != null && ` — ${hs.total_session_count} total sessions`}
        </p>
      )}

      {lastSessions.length > 0 && (
        <>
          <p className="panel-heading" style={{ fontSize: '0.75rem', marginBottom: 6 }}>
            Recent Sessions (last {lastSessions.length})
          </p>
          <div className="data-table-wrap" style={{ marginBottom: 12 }}>
            <table className="session-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Software</th>
                  <th>SW Version</th>
                  <th>Hardware</th>
                </tr>
              </thead>
              <tbody>
                {lastSessions.map((s, i) => (
                  <SessionRow key={i} session={s} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hs.devices.length > 0 && (
        <>
          <p className="panel-heading" style={{ fontSize: '0.75rem', marginBottom: 6 }}>
            Devices ({hs.devices.length})
          </p>
          <ul className="usb-list" style={{ marginBottom: 12 }}>
            {hs.devices.map((dev, i) => (
              <li key={i} className="usb-item">
                {dev.name ?? dev.device_id ?? 'Unknown'}
                {dev.device_type && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>[{dev.device_type}]</span>}
                {dev.ip_address && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>{dev.ip_address}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {hs.errors.length > 0 && (
        <div className="problem-box">
          <div className="problem-box-title">Errors ({hs.errors.length})</div>
          {hs.errors.map((err, i) => (
            <div key={i} className="problem-item">
              {err.source_name && <strong>{err.source_name}: </strong>}
              {err.description ?? err.error_code ?? 'Unknown error'}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SessionRow({ session }: { session: HardwareServiceSession }) {
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{session.timestamp ?? '—'}</td>
      <td>{session.sw_name ?? '—'}</td>
      <td><code>{session.sw_version ?? '—'}</code></td>
      <td>{session.hardware_type ?? '—'}</td>
    </tr>
  )
}

/* ---- Hardware Config ---- */
function HardwareConfigCard({ entries }: { entries: string[] }) {
  return (
    <section className="card">
      <details className="panel-details">
        <summary>Hardware Config ({entries.length} entries)</summary>
        <div className="details-body">
          <pre style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(entries, null, 2)}
          </pre>
        </div>
      </details>
    </section>
  )
}
