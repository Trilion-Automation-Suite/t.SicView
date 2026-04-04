import type {
  ParseResult,
  SystemInfo,
  ZeissVersions,
  StorageDrive,
  USBInfo,
  LicenseInfo,
  DriverInfo,
} from '../../worker/models'
import './SystemPanel.css'
import './Results.css'

interface Props {
  result: ParseResult
}

export function SystemPanel({ result }: Props) {
  const { system_info, zeiss_versions, codemeter, usb, product_type, detected_product, licensing, drivers } = result

  // Prefer the full version from InstalledPrograms.log (e.g. 7.0.2770.0) over JSON majorVersion ("7")
  const zqsFromDrivers = drivers?.all_relevant_drivers.find((d) =>
    /ZEISS\s+Quality\s+Suite/i.test(d.name),
  )?.version

  const enrichedVersions: ZeissVersions | undefined = zeiss_versions
    ? {
        ...zeiss_versions,
        quality_suite_version: zqsFromDrivers ?? zeiss_versions.quality_suite_version,
      }
    : undefined

  return (
    <div className="system-panel">
      {licensing && (licensing.dongles.length > 0 || licensing.licensed_products.length > 0) && (
        <DongleCard licensing={licensing} />
      )}
      <ZeissVersionsCard versions={enrichedVersions} productType={product_type} detectedProduct={detected_product} />
      {system_info && <SystemInfoCard info={system_info} />}
      {system_info && system_info.problem_devices.length > 0 && (
        <ProblemDevicesCard devices={system_info.problem_devices} />
      )}
      {system_info && Object.keys(system_info.display_info).length > 0 && (
        <DisplayInfoCard display={system_info.display_info} />
      )}
      {codemeter && codemeter.drives.length > 0 && (
        <DiskDrivesCard drives={codemeter.drives} />
      )}
      {usb && usb.devices.length > 0 && <USBCard usb={usb} />}
      {zeiss_versions && Object.keys(zeiss_versions.raw_version_data).length > 0 && (
        <RawVersionCard raw={zeiss_versions.raw_version_data} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ZEISS Versions                                                       */
/* ------------------------------------------------------------------ */
function ZeissVersionsCard({
  versions,
  productType,
  detectedProduct,
}: {
  versions?: ZeissVersions
  productType?: string
  detectedProduct?: string
}) {
  const rows: Array<{ label: string; value?: string }> = [
    { label: 'ZEISS INSPECT', value: versions?.inspect_version },
    { label: 'Hardware Service', value: versions?.hardware_service_version },
    { label: 'Quality Suite', value: versions?.quality_suite_version },
    { label: 'Product Name', value: versions?.product_name },
  ]

  const major = parseMajorVersion(versions?.inspect_version)
  const effectiveProduct = detectedProduct ?? (productType !== 'Unknown' ? productType : undefined)
  const mismatch = detectedProduct && productType && productType !== 'Unknown' && productType !== detectedProduct

  return (
    <section className="system-section card">
      <div className="section-title-row">
        <h2 className="section-title">ZEISS Versions</h2>
        {effectiveProduct && <span className="summary-chip">{effectiveProduct}</span>}
        {major && <span className="summary-chip summary-chip-muted">v{major}</span>}
      </div>
      <div className="versions-table-wrap">
        <table className="versions-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, value }) => (
              <tr key={label}>
                <td>{label}</td>
                <td><code>{value ?? '—'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mismatch && (
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--severity-warning)' }}>
          ⚠ Selected product "{productType}" differs from detected "{detectedProduct}"
        </p>
      )}
    </section>
  )
}

function parseMajorVersion(version?: string): string | null {
  if (!version) return null
  const match = version.match(/^(\d{4})/)
  return match ? match[1] : null
}

function RawVersionCard({ raw }: { raw: Record<string, unknown> }) {
  return (
    <section className="system-section card">
      <details>
        <summary className="section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
          Raw Version Data
        </summary>
        <pre style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(raw, null, 2)}
        </pre>
      </details>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* System Info                                                          */
/* ------------------------------------------------------------------ */
function SystemInfoCard({ info }: { info: SystemInfo }) {
  const fields: Array<{ label: string; value?: string }> = [
    { label: 'Computer Name', value: info.computer_name },
    { label: 'OS Name', value: info.os_name },
    { label: 'OS Version', value: info.os_version },
    { label: 'Processor', value: info.processor },
    { label: 'Total Memory', value: info.total_physical_memory },
    { label: 'BIOS Version', value: info.bios_version },
    { label: 'Baseboard', value: info.baseboard_product },
    { label: 'Manufacturer', value: info.system_manufacturer },
    { label: 'Model', value: info.system_model },
  ]

  return (
    <section className="system-section card">
      <h2 className="section-title">System Information</h2>
      <dl className="info-grid">
        {fields.map(({ label, value }) => (
          <KVRow key={label} label={label} value={value} />
        ))}
      </dl>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Problem Devices                                                      */
/* ------------------------------------------------------------------ */
function ProblemDevicesCard({ devices }: { devices: string[] }) {
  return (
    <section className="system-section card">
      <div className="problem-box">
        <div className="problem-box-title">Problem Devices ({devices.length})</div>
        {devices.map((d, i) => (
          <div key={i} className="problem-item">{d}</div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Display / GPU Info                                                   */
/* ------------------------------------------------------------------ */
function DisplayInfoCard({ display }: { display: Record<string, unknown> }) {
  return (
    <section className="system-section card">
      <h2 className="section-title">Display / GPU</h2>
      <dl className="info-grid">
        {Object.entries(display).map(([key, val]) => (
          <KVRow key={key} label={key} value={val != null ? String(val) : undefined} />
        ))}
      </dl>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Disk Drives                                                          */
/* ------------------------------------------------------------------ */
function DiskDrivesCard({ drives }: { drives: StorageDrive[] }) {
  return (
    <section className="system-section card">
      <h2 className="section-title">Disk Drives</h2>
      {drives.map((drive, i) => {
        const total = drive.total_mb
        const free = drive.free_mb
        const used = total != null && free != null ? total - free : null
        const pctFree = total != null && free != null && total > 0 ? (free / total) * 100 : null
        const pctUsed = pctFree != null ? 100 - pctFree : null
        const isCritical = pctFree != null && pctFree < 10
        const isWarning = pctFree != null && pctFree >= 10 && pctFree < 20

        return (
          <div key={i} className="drive-card card">
            <div className="drive-header">
              <span className="drive-letter">{drive.letter}:</span>
              {drive.label && <span className="drive-label">{drive.label}</span>}
              {drive.drive_type && (
                <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>
                  {drive.drive_type}
                </span>
              )}
            </div>
            {total != null && (
              <>
                <div className="drive-stats">
                  {used != null ? `${(used / 1024).toFixed(1)} GB` : '?'} used
                  {' / '}
                  {(total / 1024).toFixed(1)} GB total
                  {pctFree != null && ` — ${pctFree.toFixed(1)}% free`}
                </div>
                <div className="progress-bar-track">
                  <div
                    className={`progress-bar-fill${isCritical ? ' progress-bar-fill--critical' : isWarning ? ' progress-bar-fill--warning' : ''}`}
                    style={{ width: `${Math.min(100, pctUsed ?? 0)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* USB Devices                                                          */
/* ------------------------------------------------------------------ */
function USBCard({ usb }: { usb: USBInfo }) {
  return (
    <section className="system-section card">
      <h2 className="section-title">USB Devices ({usb.devices.length})</h2>
      <ul className="usb-list">
        {usb.devices.map((dev, i) => (
          <li key={i} className="usb-item">
            {dev.name ?? dev.device_id ?? 'Unknown USB device'}
            {dev.status && dev.status !== 'OK' && (
              <span style={{ marginLeft: 8, color: 'var(--severity-warning)', fontSize: 11 }}>
                [{dev.status}]
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Dongle / License Identity                                            */
/* ------------------------------------------------------------------ */
function DongleCard({ licensing }: { licensing: LicenseInfo }) {
  return (
    <section className="system-section card">
      <h2 className="section-title">License &amp; Dongle</h2>
      <dl className="info-grid">
        {licensing.dongles.map((d, i) => (
          <KVRow
            key={`dongle-${i}`}
            label={d.dongle_type ? `Dongle (${d.dongle_type})` : 'Dongle'}
            value={d.serial}
          />
        ))}
        {licensing.licensed_products.length > 0 && (
          <KVRow
            label="Licensed Products"
            value={licensing.licensed_products.join(' · ')}
          />
        )}
      </dl>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* KV Row helper                                                        */
/* ------------------------------------------------------------------ */
function KVRow({ label, value }: { label: string; value?: string }) {
  const display = value == null || value === '' ? '—' : value
  const isEmpty = display === '—'

  return (
    <>
      <dt className="info-label">{label}</dt>
      <dd className={`info-value${isEmpty ? ' kv-value--empty' : ''}`}>{display}</dd>
    </>
  )
}
