import type { ParseResult, CameraConfig, ControllerDiscovery } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function CamerasPanel({ result }: Props) {
  const { cameras } = result

  const hasControllers = cameras && cameras.controllers.length > 0
  const hasCameras = cameras && cameras.cameras.length > 0
  const hasSensors = cameras && cameras.detected_sensors.length > 0

  if (!cameras || (!hasControllers && !hasCameras && !hasSensors)) {
    return (
      <div className="card panel-placeholder">No camera or controller data found.</div>
    )
  }

  return (
    <div className="panel-stack">
      {/* Controller network overview */}
      {(cameras.controller_ip ?? cameras.controller_subnet) && (
        <section className="card">
          <h2 className="panel-heading">Controller Network</h2>
          <dl className="info-grid">
            {cameras.controller_ip && (
              <>
                <dt className="info-label">Controller IP</dt>
                <dd className="info-value"><code>{cameras.controller_ip}</code></dd>
              </>
            )}
            {cameras.controller_subnet && (
              <>
                <dt className="info-label">Subnet</dt>
                <dd className="info-value"><code>{cameras.controller_subnet}</code></dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Controllers */}
      {hasControllers && (
        <section className="card">
          <h2 className="panel-heading">Controllers ({cameras.controllers.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cameras.controllers.map((ctrl, i) => (
              <ControllerCard key={i} controller={ctrl} />
            ))}
          </div>
        </section>
      )}

      {/* Camera configs */}
      {hasCameras && (
        <section className="card">
          <h2 className="panel-heading">Camera Configurations ({cameras.cameras.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cameras.cameras.map((cam, i) => (
              <CameraCard key={i} camera={cam} />
            ))}
          </div>
        </section>
      )}

      {/* Detected sensors */}
      {hasSensors && (
        <section className="card">
          <h2 className="panel-heading">Detected Sensors ({cameras.detected_sensors.length})</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Sensor</th>
                </tr>
              </thead>
              <tbody>
                {cameras.detected_sensors.map((s, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
                    <td>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function ControllerCard({ controller }: { controller: ControllerDiscovery }) {
  return (
    <div className="camera-card card">
      <div className="camera-name">
        {controller.name ?? controller.device_type ?? 'Controller'}
      </div>
      <dl className="info-grid">
        {controller.device_type && (
          <>
            <dt className="info-label">Device Type</dt>
            <dd className="info-value">{controller.device_type}</dd>
          </>
        )}
        {controller.sensor_type && (
          <>
            <dt className="info-label">Sensor Type</dt>
            <dd className="info-value">{controller.sensor_type}</dd>
          </>
        )}
        {controller.firmware && (
          <>
            <dt className="info-label">Firmware</dt>
            <dd className="info-value"><code>{controller.firmware}</code></dd>
          </>
        )}
        {controller.ip_address && (
          <>
            <dt className="info-label">IP Address</dt>
            <dd className="info-value"><code>{controller.ip_address}</code></dd>
          </>
        )}
        {controller.broadcast_address && (
          <>
            <dt className="info-label">Broadcast</dt>
            <dd className="info-value"><code>{controller.broadcast_address}</code></dd>
          </>
        )}
      </dl>
    </div>
  )
}

function CameraCard({ camera }: { camera: CameraConfig }) {
  return (
    <div className="camera-card card">
      <div className="camera-name">
        {camera.camera_name ?? camera.model ?? 'Camera'}
      </div>
      <dl className="info-grid">
        {camera.model && (
          <>
            <dt className="info-label">Model</dt>
            <dd className="info-value">{camera.model}</dd>
          </>
        )}
        {camera.serial_number && (
          <>
            <dt className="info-label">Serial</dt>
            <dd className="info-value"><code>{camera.serial_number}</code></dd>
          </>
        )}
        {camera.ip_address && (
          <>
            <dt className="info-label">IP Address</dt>
            <dd className="info-value"><code>{camera.ip_address}</code></dd>
          </>
        )}
        {camera.mac_address && (
          <>
            <dt className="info-label">MAC Address</dt>
            <dd className="info-value"><code>{camera.mac_address}</code></dd>
          </>
        )}
        {camera.interface_name && (
          <>
            <dt className="info-label">Interface</dt>
            <dd className="info-value">{camera.interface_name}</dd>
          </>
        )}
        {camera.gev_packet_size && (
          <>
            <dt className="info-label">GEV Packet Size</dt>
            <dd className="info-value">{camera.gev_packet_size}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
