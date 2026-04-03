import type { ParseResult, NetworkAdapter } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function NetworkPanel({ result }: Props) {
  const { network } = result

  if (!network) {
    return (
      <div className="card panel-placeholder">No network data available.</div>
    )
  }

  return (
    <div className="panel-stack">
      {/* Host info */}
      {(network.hostname ?? network.domain) && (
        <section className="card">
          <h2 className="panel-heading">Host</h2>
          <dl className="info-grid">
            {network.hostname && (
              <>
                <dt className="info-label">Hostname</dt>
                <dd className="info-value">{network.hostname}</dd>
              </>
            )}
            {network.domain && (
              <>
                <dt className="info-label">Domain</dt>
                <dd className="info-value">{network.domain}</dd>
              </>
            )}
            {network.dns_servers.length > 0 && (
              <>
                <dt className="info-label">DNS Servers</dt>
                <dd className="info-value">
                  <ul className="addr-list">
                    {network.dns_servers.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Adapters */}
      {network.adapters.length === 0 ? (
        <div className="card panel-placeholder">No network adapters found.</div>
      ) : (
        network.adapters.map((adapter, i) => (
          <AdapterCard key={i} adapter={adapter} />
        ))
      )}
    </div>
  )
}

function AdapterCard({ adapter }: { adapter: NetworkAdapter }) {
  const state = inferConnectionState(adapter)

  const advKeys = Object.keys(adapter.advanced_properties)

  return (
    <section className="card net-adapter-card">
      <div className="net-adapter-header">
        <span className="net-adapter-name">{adapter.name}</span>
        <span className={`badge ${stateBadgeClass(state)}`}>{state}</span>
      </div>

      <dl className="info-grid">
        {adapter.description && (
          <>
            <dt className="info-label">Description</dt>
            <dd className="info-value">{adapter.description}</dd>
          </>
        )}
        {adapter.mac_address && (
          <>
            <dt className="info-label">MAC Address</dt>
            <dd className="info-value"><code>{adapter.mac_address}</code></dd>
          </>
        )}
        {adapter.ip_addresses.length > 0 && (
          <>
            <dt className="info-label">IP Addresses</dt>
            <dd className="info-value">
              <ul className="addr-list">
                {adapter.ip_addresses.map((ip, i) => <li key={i}>{ip}</li>)}
              </ul>
            </dd>
          </>
        )}
        {adapter.subnet_masks.length > 0 && (
          <>
            <dt className="info-label">Subnet Masks</dt>
            <dd className="info-value">
              <ul className="addr-list">
                {adapter.subnet_masks.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </dd>
          </>
        )}
        {adapter.default_gateway && (
          <>
            <dt className="info-label">Default Gateway</dt>
            <dd className="info-value"><code>{adapter.default_gateway}</code></dd>
          </>
        )}
        {adapter.dhcp_enabled != null && (
          <>
            <dt className="info-label">DHCP</dt>
            <dd className="info-value">{adapter.dhcp_enabled ? 'Enabled' : 'Disabled'}</dd>
          </>
        )}
        {adapter.link_speed && (
          <>
            <dt className="info-label">Link Speed</dt>
            <dd className="info-value">{adapter.link_speed}</dd>
          </>
        )}
        {adapter.dns_servers.length > 0 && (
          <>
            <dt className="info-label">DNS Servers</dt>
            <dd className="info-value">
              <ul className="addr-list">
                {adapter.dns_servers.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </dd>
          </>
        )}
        {adapter.driver_name && (
          <>
            <dt className="info-label">Driver</dt>
            <dd className="info-value">{adapter.driver_name}{adapter.driver_version ? ` v${adapter.driver_version}` : ''}</dd>
          </>
        )}
      </dl>

      {advKeys.length > 0 && (
        <details className="panel-details" style={{ marginTop: 12 }}>
          <summary>Advanced Properties ({advKeys.length})</summary>
          <div className="details-body">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {advKeys.map(key => (
                    <tr key={key}>
                      <td><code>{key}</code></td>
                      <td>{String(adapter.advanced_properties[key] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </section>
  )
}

function inferConnectionState(adapter: NetworkAdapter): 'Connected' | 'Disconnected' | 'Unknown' {
  if (adapter.ip_addresses.length > 0) return 'Connected'
  if (adapter.link_speed && adapter.link_speed !== '0') return 'Connected'
  if (adapter.ip_addresses.length === 0 && adapter.mac_address) return 'Disconnected'
  return 'Unknown'
}

function stateBadgeClass(state: string): string {
  if (state === 'Connected') return 'badge-connected'
  if (state === 'Disconnected') return 'badge-disconnected'
  return 'badge-neutral'
}
