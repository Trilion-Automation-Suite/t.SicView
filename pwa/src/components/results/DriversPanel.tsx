import { Fragment } from 'react'
import type { ParseResult, DriverInfo, InstalledDriver, GPUInfo } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function DriversPanel({ result }: Props) {
  const { drivers } = result

  if (!drivers) {
    return (
      <div className="card panel-placeholder">No driver data available.</div>
    )
  }

  return (
    <div className="panel-stack">
      <KeyDriversCard drivers={drivers} />
      {drivers.gpu && <GPUCard gpu={drivers.gpu} />}
      {drivers.all_relevant_drivers.length > 0 && (
        <AllDriversCard drivers={drivers.all_relevant_drivers} />
      )}
      {drivers.install_timeline.length > 0 && (
        <InstallTimelineCard timeline={drivers.install_timeline} />
      )}
    </div>
  )
}

/* ---- Key Drivers ---- */
type KeyDriver = {
  name: string
  version?: string
  install_date?: string
}

function KeyDriversCard({ drivers }: { drivers: DriverInfo }) {
  const find = (re: RegExp): InstalledDriver | undefined =>
    drivers.all_relevant_drivers.find((d) => re.test(d.name))

  const cvb = find(/Common\s+Vision\s+Blox/i)
  const zqs = find(/ZEISS\s+Quality\s+Suite/i)

  const keys: Array<{ label: string; version?: string }> = [
    { label: 'NVIDIA Driver',        version: drivers.nvidia_driver },
    { label: 'Mellanox Driver',      version: drivers.mellanox_driver },
    { label: 'Rivermax',             version: drivers.rivermax },
    { label: 'CodeMeter',            version: drivers.codemeter },
    { label: 'Common Vision Blox',   version: cvb?.version },
    { label: 'ZEISS Quality Suite',  version: zqs?.version },
  ]

  return (
    <section className="card">
      <h2 className="panel-heading">Key Drivers</h2>
      <div className="key-driver-grid">
        {keys.map(({ label, version }) => (
          <KeyDriverCard key={label} name={label} version={version} />
        ))}
      </div>
    </section>
  )
}

function KeyDriverCard({ name, version }: { name: string; version?: string }) {
  const present = version != null && version !== ''
  return (
    <div className="key-driver-card">
      <div className="key-driver-name">{name}</div>
      {present ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--severity-ok)', marginBottom: 2 }}>&#10003; Present</div>
          <div className="key-driver-version">{version}</div>
        </>
      ) : (
        <div className="key-driver-absent">&#8212; Not found</div>
      )}
    </div>
  )
}

/* ---- GPU Info ---- */
function GPUCard({ gpu }: { gpu: GPUInfo }) {
  const fields: Array<{ label: string; value: string }> = (
    [
      { label: 'GPU Name', value: gpu.name },
      { label: 'Driver Version', value: gpu.driver_version },
      { label: 'CUDA Version', value: gpu.cuda_version },
      { label: 'Memory Total', value: gpu.memory_total },
      { label: 'Memory Used', value: gpu.memory_used },
      { label: 'Temperature', value: gpu.temperature },
      { label: 'Power Draw', value: gpu.power_draw },
      { label: 'PCIe Gen', value: gpu.pcie_gen },
    ] as Array<{ label: string; value?: string }>
  ).filter((f): f is { label: string; value: string } => f.value != null)

  return (
    <section className="card">
      <h2 className="panel-heading">GPU Information</h2>
      <dl className="info-grid">
        {fields.map(({ label, value }) => (
          <Fragment key={label}>
            <dt className="info-label">{label}</dt>
            <dd className="info-value">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  )
}

/* ---- All Relevant Drivers ---- */
function AllDriversCard({ drivers }: { drivers: InstalledDriver[] }) {
  return (
    <section className="card">
      <h2 className="panel-heading">Relevant Drivers ({drivers.length})</h2>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Publisher</th>
              <th>Install Date</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d, i) => (
              <tr key={i}>
                <td>{d.name}</td>
                <td><code>{d.version ?? '—'}</code></td>
                <td>{d.publisher ?? '—'}</td>
                <td>{d.install_date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---- Install Timeline ---- */
function InstallTimelineCard({ timeline }: { timeline: InstalledDriver[] }) {
  // Sort newest-first (install_date descending; undated go last)
  const sorted = [...timeline].sort((a, b) => {
    if (!a.install_date && !b.install_date) return 0
    if (!a.install_date) return 1
    if (!b.install_date) return -1
    return b.install_date.localeCompare(a.install_date)
  })

  return (
    <section className="card">
      <details className="panel-details">
        <summary>Install Timeline ({timeline.length} programs)</summary>
        <div className="details-body">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Install Date</th>
                  <th>Name</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{d.install_date ?? '—'}</td>
                    <td>{d.name}</td>
                    <td><code>{d.version ?? '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  )
}
