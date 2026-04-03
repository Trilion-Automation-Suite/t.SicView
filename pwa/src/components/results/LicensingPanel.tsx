import type { ParseResult, LicenseEntry, DongleInfo } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function LicensingPanel({ result }: Props) {
  const { licensing } = result

  if (!licensing) {
    return (
      <div className="card panel-placeholder">No licensing data found.</div>
    )
  }

  return (
    <div className="panel-stack">
      {/* Dongles */}
      <section className="card">
        <h2 className="panel-heading">Dongles</h2>
        {licensing.dongles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No dongles found.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Serial</th>
                </tr>
              </thead>
              <tbody>
                {licensing.dongles.map((d, i) => (
                  <DongleRow key={i} dongle={d} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Licenses table */}
      {licensing.licenses.length > 0 && (
        <section className="card">
          <h2 className="panel-heading">Licenses ({licensing.licenses.length})</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>License Name</th>
                  <th>Expiry</th>
                  <th>Type</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {licensing.licenses.map((lic, i) => (
                  <LicenseRow key={i} license={lic} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Licensed products */}
      {licensing.licensed_products.length > 0 && (
        <section className="card">
          <h2 className="panel-heading">Licensed Products</h2>
          <div className="product-badge-list">
            {licensing.licensed_products.map((p, i) => (
              <span key={i} className="product-badge">{p}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function DongleRow({ dongle }: { dongle: DongleInfo }) {
  return (
    <tr>
      <td>{dongle.dongle_type ?? '—'}</td>
      <td><code>{dongle.serial ?? '—'}</code></td>
    </tr>
  )
}

function LicenseRow({ license }: { license: LicenseEntry }) {
  const expiry = license.expiry
  const isExpired = expiry != null && expiry !== 'Permanent' && new Date(expiry) < new Date()

  return (
    <tr>
      <td>{license.product ?? '—'}</td>
      <td>{license.key ?? '—'}</td>
      <td style={{ color: isExpired ? 'var(--severity-critical)' : undefined }}>
        {expiry ?? '—'}
        {isExpired && <span style={{ marginLeft: 6, fontSize: 10 }}>(EXPIRED)</span>}
      </td>
      <td>{license.license_type ?? '—'}</td>
      <td><code>{license.version ?? '—'}</code></td>
    </tr>
  )
}
