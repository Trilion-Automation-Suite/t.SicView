import { Fragment } from 'react'
import type { ParseResult, ZeissVersions } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function VersionsPanel({ result }: Props) {
  const { zeiss_versions, product_type, detected_product, drivers } = result

  // Prefer the full version from InstalledPrograms.log (e.g. 7.0.2770.0) over JSON majorVersion ("7")
  const zqsFromDrivers = drivers?.all_relevant_drivers.find(d =>
    /ZEISS\s+Quality\s+Suite/i.test(d.name),
  )?.version

  const enrichedVersions: ZeissVersions | undefined = zeiss_versions
    ? {
        ...zeiss_versions,
        quality_suite_version: zqsFromDrivers ?? zeiss_versions.quality_suite_version,
      }
    : undefined

  return (
    <div className="panel-stack">
      <InspectVersionCard versions={enrichedVersions} />
      <ProductCard
        productType={product_type}
        detectedProduct={detected_product}
        versions={enrichedVersions}
      />
      {zeiss_versions && Object.keys(zeiss_versions.raw_version_data).length > 0 && (
        <RawVersionCard raw={zeiss_versions.raw_version_data} />
      )}
    </div>
  )
}

/* ---- ZEISS INSPECT version card ---- */
function InspectVersionCard({ versions }: { versions?: ZeissVersions }) {
  const rows: Array<{ label: string; value?: string }> = [
    { label: 'ZEISS INSPECT', value: versions?.inspect_version },
    { label: 'Quality Suite', value: versions?.quality_suite_version },
    { label: 'Hardware Service', value: versions?.hardware_service_version },
    { label: 'Product Name', value: versions?.product_name },
  ]

  const majorVersion = parseMajorVersion(versions?.inspect_version)

  return (
    <section className="card">
      <h2 className="panel-heading">ZEISS Software Versions</h2>
      {majorVersion && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Major version: <strong style={{ color: 'var(--accent)' }}>{majorVersion}</strong>
        </p>
      )}
      <dl className="info-grid">
        {rows.map(({ label, value }) => (
          <Fragment key={label}>
            <dt className="info-label">{label}</dt>
            <dd className="info-value">
              {value ? <code>{value}</code> : <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>—</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  )
}

/* ---- Product card ---- */
function ProductCard({
  productType,
  detectedProduct,
  versions,
}: {
  productType: string
  detectedProduct?: string
  versions?: ZeissVersions
}) {
  return (
    <section className="card">
      <h2 className="panel-heading">Product Identity</h2>
      <dl className="info-grid">
        <dt className="info-label">User-selected Product</dt>
        <dd className="info-value">{productType}</dd>

        {detectedProduct && (
          <>
            <dt className="info-label">Detected Product</dt>
            <dd className="info-value">{detectedProduct}</dd>
          </>
        )}

        {versions?.product_name && (
          <>
            <dt className="info-label">Installed Product Name</dt>
            <dd className="info-value">{versions.product_name}</dd>
          </>
        )}

        {detectedProduct && productType !== detectedProduct && productType !== 'Unknown' && (
          <>
            <dt className="info-label">Mismatch</dt>
            <dd className="info-value" style={{ color: 'var(--severity-warning)' }}>
              User selection differs from detected product
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}

/* ---- Raw version data ---- */
function RawVersionCard({ raw }: { raw: Record<string, unknown> }) {
  return (
    <section className="card">
      <details className="panel-details">
        <summary>Raw Version Data</summary>
        <div className="details-body">
          <pre style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      </details>
    </section>
  )
}

/* ---- helpers ---- */
function parseMajorVersion(version?: string): string | null {
  if (!version) return null
  // e.g. "2024.2.0" → "2024", or "2023 SR2" → "2023"
  const match = version.match(/^(\d{4})/)
  return match ? match[1] : null
}
