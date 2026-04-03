// ============================================================
// parsers/cameras.ts — Port of Python CamerasParser
// Sources: acquisition logs, HAL logs, sensor init protocol
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { CameraInfo, CameraConfig, ControllerDiscovery } from '../models'
import { gomsicLogDir, zqsGomLogDir } from '../extractor'

const LOG_PATTERNS = [
  'zi_acq_*.log',
  'GOM-ACQ-*.log',
  'GOM-HAL-*.log',
  'sensor_initialization_protocol.log',
]

export class CamerasParser extends BaseParser<CameraInfo> {
  readonly name = 'cameras'

  parse(ctx: ParserContext): CameraInfo | null {
    const { layout } = ctx

    const info: CameraInfo = {
      cameras: [],
      controllers: [],
      detected_sensors: [],
    }

    const logDir = gomsicLogDir(layout)
    const zqsDir = zqsGomLogDir(layout)

    const candidatePaths = new Set<string>()
    for (const dir of [logDir, zqsDir]) {
      if (!dir) continue
      for (const pattern of LOG_PATTERNS) {
        const found = this.findFiles(layout, dir, pattern)
        for (const f of found) candidatePaths.add(f)
      }
    }

    if (candidatePaths.size === 0) return null

    for (const vpath of candidatePaths) {
      const text = this.getText(layout, vpath)
      if (!text) continue

      const filename = vpath.split('/').pop() ?? ''

      if (filename.toLowerCase() === 'sensor_initialization_protocol.log') {
        this._parseSensorInitProtocol(text, info)
      } else {
        this._parseAcqLog(text, info)
      }
    }

    if (
      info.cameras.length === 0 &&
      info.controllers.length === 0 &&
      info.detected_sensors.length === 0
    ) {
      return null
    }

    return info
  }

  private _parseAcqLog(text: string, info: CameraInfo): void {
    // Controller discovery (broadcast JSON)
    // e.g.: Answer on 255.255.255.255:25025 = {"Version":"2",...}
    const broadcastRe = /Answer on ([\d.]+:\d+)\s*=\s*(\{.*?\})/g
    let bm: RegExpExecArray | null
    while ((bm = broadcastRe.exec(text)) !== null) {
      const broadcastAddr = bm[1]
      const jsonStr = bm[2]
      try {
        const data = JSON.parse(jsonStr) as Record<string, string>
        const controller: ControllerDiscovery = {
          broadcast_address: broadcastAddr,
          raw_json: jsonStr,
          device_type: data['DeviceType'],
          sensor_type: data['SensorType'],
          name: data['Name'],
          firmware: data['Firmware'],
          ip_address: data['IP']?.replace(/^,/, '').trim(),
        }
        // Avoid duplicates by IP
        if (!info.controllers.some((c) => c.ip_address === controller.ip_address && c.name === controller.name)) {
          info.controllers.push(controller)
        }
        if (controller.ip_address && !info.controller_ip) {
          info.controller_ip = controller.ip_address
        }
      } catch {
        // Invalid JSON — skip
      }
    }

    // Detected sensors
    // e.g.: Detected sensor type C2023 at IP 192.168.6.200
    const sensorRe = /Detected sensor type\s+(\S+)\s+at IP\s+([\d.]+)/gi
    let sm: RegExpExecArray | null
    while ((sm = sensorRe.exec(text)) !== null) {
      const sensorEntry = `${sm[1]} @ ${sm[2]}`
      if (!info.detected_sensors.includes(sensorEntry)) {
        info.detected_sensors.push(sensorEntry)
      }
    }

    // Found cameras
    // e.g.: Found camera HB-25000SBM with serial number 2007241
    const cameraRe = /Found camera\s+(\S+)\s+with serial number\s+(\S+)/gi
    let cm: RegExpExecArray | null
    while ((cm = cameraRe.exec(text)) !== null) {
      const model = cm[1]
      const serial = cm[2]
      // Avoid duplicates by serial
      if (!info.cameras.some((c) => c.serial_number === serial)) {
        const cam: CameraConfig = {
          model,
          serial_number: serial,
          raw_config: {},
        }
        info.cameras.push(cam)
      }
    }
  }

  private _parseSensorInitProtocol(text: string, info: CameraInfo): void {
    // Format: [timestamp] "name" "ip"
    const re = /\[([^\]]+)\]\s+"([^"]+)"\s+"([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const timestamp = m[1]
      const name = m[2]
      const ip = m[3]

      // Try to match to an existing camera by name, or add new
      const existing = info.cameras.find((c) => c.camera_name === name)
      if (existing) {
        if (!existing.ip_address) existing.ip_address = ip
      } else {
        const cam: CameraConfig = {
          camera_name: name,
          ip_address: ip,
          raw_config: { init_timestamp: timestamp },
        }
        info.cameras.push(cam)
      }
    }
  }
}
