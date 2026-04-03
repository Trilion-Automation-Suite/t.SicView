// ============================================================
// parsers/hardware-service.ts — Port of Python HardwareServiceParser
// Most complex parser: HAL logs, SQLite DB, XML config, tasklist
// ============================================================

import { BaseParser, ParserContext } from './base'
import type {
  HardwareServiceInfo,
  HardwareServiceSession,
  HardwareServiceDevice,
  HardwareServiceError,
} from '../models'
import { gomsicLogDir, zqsInstalledSoftwareDir } from '../extractor'
import type { SqlJsStatic } from 'sql.js'

// ---- Lazy sql.js singleton ----

let _SQL: SqlJsStatic | null = null

async function getSql(): Promise<SqlJsStatic> {
  if (!_SQL) {
    const initSqlJs = ((await import('sql.js')) as { default: (opts: unknown) => Promise<SqlJsStatic> }).default
    // Resolve wasm path relative to worker bundle (works with any VITE_BASE subpath)
    const wasmUrl = new URL('../sql-wasm.wasm', import.meta.url).href
    _SQL = await initSqlJs({ locateFile: () => wasmUrl })
  }
  return _SQL
}

export class HardwareServiceParser extends BaseParser<HardwareServiceInfo> {
  readonly name = 'hardware_service'

  // Synchronous stub — the real implementation is parseAsync
  parse(_ctx: ParserContext): HardwareServiceInfo | null {
    return null
  }

  async parseAsync(ctx: ParserContext): Promise<HardwareServiceInfo | null> {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const info: HardwareServiceInfo = {
      ports: [],
      timeline: [],
      sessions: [],
      devices: [],
      errors: [],
      db_tables: [],
      multiple_instances: false,
      related_processes: {},
      hardware_cfg_entries: [],
      rivermax_env_vars: {},
      firewall_rules_found: [],
    }

    let foundSomething = false

    // --- 1. Version from ZQS InstalledSoftware ---
    const installedSoftwareDir = zqsInstalledSoftwareDir(layout)
    if (installedSoftwareDir) {
      const versionFiles = this.findFiles(
        layout,
        `${installedSoftwareDir}/ZEISS-INSPECT-Hardware-Service`,
        '*/version-index.json',
      )
      for (const vf of versionFiles) {
        const text = this.getText(layout, vf)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          const v = data['version'] ?? data['Version'] ?? data['appVersion']
          if (typeof v === 'string') {
            info.version = v
            foundSomething = true
            break
          }
        } catch {
          // continue
        }
      }
    }

    // --- 2. HAL log parsing ---
    const logDir = gomsicLogDir(layout)
    if (logDir) {
      const halLogs = this.findFiles(layout, logDir, 'GOM-HAL-*.log')
      if (halLogs.length > 0) {
        // Use last alphabetically
        const halLog = halLogs[halLogs.length - 1]
        const halText = this.getText(layout, halLog)
        if (halText) {
          this._parseHalLog(halText, info)
          foundSomething = true
        }
      }
    }

    // --- 3. tasklist.log — check if running ---
    const tasklistText = this.getText(layout, `${gomsicDir}/tasklist.log`)
    if (tasklistText) {
      this._parseTasklist(tasklistText, info)
      foundSomething = true
    }

    // --- 4. hardware_status.db (SQLite via sql.js) ---
    const dbBytes = layout.files.get(`${gomsicDir}/all-config/hardware_status.db`)
    if (dbBytes) {
      try {
        await this._parseStatusDb(dbBytes, info)
        foundSomething = true
      } catch {
        // db parsing failed — continue
      }
    }

    // --- 5. hardware_cfg.xml (regex, no DOMParser) ---
    const cfgText = this.getText(layout, `${gomsicDir}/all-config/hardware_cfg.xml`)
    if (cfgText) {
      this._parseHardwareCfg(cfgText, info)
      foundSomething = true
    }

    // --- 6. registry.log ---
    const registryText = this.getText(layout, `${gomsicDir}/registry.log`)
    if (registryText) {
      this._parseRegistry(registryText, info)
    }

    if (!foundSomething) return null
    return info
  }

  private _parseHalLog(text: string, info: HardwareServiceInfo): void {
    const lines = text.split(/\r?\n/)

    // First 5 lines: header
    const headerLines = lines.slice(0, 5)
    for (const line of headerLines) {
      const versionMatch = line.match(/HAL\s+(?:VersionString|Version)[:\s]+([\w.\-+]+)/i)
      if (versionMatch) info.hal_version = versionMatch[1].trim()

      const branchMatch = line.match(/Branch:\s*(.+)/i)
      if (branchMatch) info.hal_branch = branchMatch[1].trim()

      const pidMatch = line.match(/PID:\s*(\d+)/i)
      if (pidMatch) info.hal_pid = pidMatch[1].trim()
    }

    // Count restart cycles
    let restartCount = 0
    for (const line of lines) {
      if (/Starting HAL/i.test(line)) restartCount++
    }
    if (restartCount > 1) {
      info.timeline.push(`HAL restarted ${restartCount} times`)
    }

    // Port patterns
    const CMD_RE = /Listening for clients on address ([\d.]+):(\d+)/i
    const BACKEND_RE = /Backend is listening.*?at ([\w.]+):(\d+)/i
    const GRPC_LISTEN_RE = /gRPC Server listening on ([\d.]+):(\d+)/i
    const GRPC_BLOCKED_RE = /gRPC server port already blocked\s*:(\d+)/i
    const PSTORE_RE = /Project store.*?started for ip:\s*([\d.]+),\s*port:\s*(\d+)/i

    const addPort = (
      address: string,
      port: number,
      service: string,
      status = 'listening',
      protocol = 'TCP',
    ): void => {
      // Avoid duplicate ports
      if (!info.ports.some((p) => p.port === port && p.service === service)) {
        info.ports.push({ address, port, service, protocol, status })
      }
    }

    for (const line of lines) {
      let m: RegExpExecArray | null

      m = CMD_RE.exec(line)
      if (m) { addPort(m[1], parseInt(m[2]), 'CMD'); continue }

      m = BACKEND_RE.exec(line)
      if (m) { addPort(m[1], parseInt(m[2]), 'Backend'); continue }

      m = GRPC_LISTEN_RE.exec(line)
      if (m) {
        addPort(m[1], parseInt(m[2]), 'gRPC')
        info.grpc_status = 'listening'
        continue
      }

      m = GRPC_BLOCKED_RE.exec(line)
      if (m) {
        info.grpc_status = 'blocked'
        info.timeline.push(`gRPC port ${m[1]} blocked`)
        continue
      }

      m = PSTORE_RE.exec(line)
      if (m) { addPort(m[1], parseInt(m[2]), 'ProjectStore'); continue }

      // Error patterns → timeline
      if (/Cannot connect to/i.test(line)) {
        const trimmed = line.trim().slice(0, 200)
        if (!info.timeline.includes(trimmed)) info.timeline.push(trimmed)
      }
      if (/hardware specification is incomplete/i.test(line)) {
        info.timeline.push('Hardware specification incomplete')
      }
      if (/Cold Start events/i.test(line)) {
        info.timeline.push('Cold Start events detected')
      }

      // IoT
      if (/Database:\s*connection ok/i.test(line)) {
        info.timeline.push('IoT DB connected')
      }
      if (/IoT Server has been started/i.test(line)) {
        info.timeline.push('IoT Server started')
      }

      // TLS errors
      if (/SSL.*fail|certificate.*fail|TLS.*error/i.test(line)) {
        info.timeline.push('TLS/Certificate error detected')
      }
    }
  }

  private _parseTasklist(text: string, info: HardwareServiceInfo): void {
    const matches = [...text.matchAll(/hardware.?service|HardwareSer/gi)]
    if (matches.length > 0) {
      info.running = true
      info.process_name = 'HardwareService'
      if (matches.length > 1) {
        info.multiple_instances = true
      }
    } else {
      info.running = false
    }
  }

  private async _parseStatusDb(dbBytes: Uint8Array, info: HardwareServiceInfo): Promise<void> {
    const SQL = await getSql()
    const db = new SQL.Database(dbBytes)

    try {
      // Get all table names
      try {
        const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
        if (tablesResult.length > 0) {
          for (const row of tablesResult[0].values as (string | number | null)[][]) {
            if (row[0]) info.db_tables.push(String(row[0]))
          }
        }
      } catch { /* ignore */ }

      // Sessions
      try {
        const sessionsResult = db.exec(
          'SELECT timestamp, sw_name, sw_version, sw_revision, sw_build_date, hardware_type, hardware_family, manufacturer, product_instance_uri FROM session_data ORDER BY rowid DESC LIMIT 5',
        )
        if (sessionsResult.length > 0) {
          const { columns, values } = sessionsResult[0] as { columns: string[]; values: (string | number | null)[][] }
          for (const row of values) {
            const session: HardwareServiceSession = {}
            columns.forEach((col, i) => {
              const val = row[i] != null ? String(row[i]) : undefined
              switch (col) {
                case 'timestamp': session.timestamp = val; break
                case 'sw_name': session.sw_name = val; break
                case 'sw_version': session.sw_version = val; break
                case 'sw_revision': session.sw_revision = val; break
                case 'sw_build_date': session.sw_build_date = val; break
                case 'hardware_type': session.hardware_type = val; break
                case 'hardware_family': session.hardware_family = val; break
                case 'manufacturer': session.manufacturer = val; break
                case 'product_instance_uri': session.product_instance_uri = val; break
              }
            })
            info.sessions.push(session)
          }
        }
      } catch { /* ignore — table may not exist */ }

      // Total session count
      try {
        const countResult = db.exec('SELECT COUNT(*) FROM session_data')
        if (countResult.length > 0) {
          const val = (countResult[0].values as (string | number | null)[][])[0]?.[0]
          if (val != null) info.total_session_count = Number(val)
        }
      } catch { /* ignore */ }

      // Devices
      try {
        const devicesResult = db.exec(
          'SELECT DISTINCT id, name, ip_address, type, uuid, version FROM group_data',
        )
        if (devicesResult.length > 0) {
          const { columns, values } = devicesResult[0] as { columns: string[]; values: (string | number | null)[][] }
          for (const row of values) {
            const device: HardwareServiceDevice = {}
            columns.forEach((col, i) => {
              const val = row[i] != null ? String(row[i]) : undefined
              switch (col) {
                case 'id': device.device_id = val; break
                case 'name': device.name = val; break
                case 'ip_address': device.ip_address = val; break
                case 'type': device.device_type = val; break
                case 'uuid': device.uuid = val; break
                case 'version': device.version = val; break
              }
            })
            info.devices.push(device)
          }
        }
      } catch { /* ignore */ }

      // Errors
      try {
        const errorsResult = db.exec(
          'SELECT source_name, error_code, description, severity FROM error_list',
        )
        if (errorsResult.length > 0) {
          const { columns, values } = errorsResult[0] as { columns: string[]; values: (string | number | null)[][] }
          for (const row of values) {
            const err: HardwareServiceError = {}
            columns.forEach((col, i) => {
              const val = row[i] != null ? String(row[i]) : undefined
              switch (col) {
                case 'source_name': err.source_name = val; break
                case 'error_code': err.error_code = val; break
                case 'description': err.description = val; break
                case 'severity': err.severity = val; break
              }
            })
            info.errors.push(err)
          }
        }
      } catch { /* ignore */ }
    } finally {
      db.close()
    }
  }

  private _parseHardwareCfg(text: string, info: HardwareServiceInfo): void {
    // Check for empty config
    if (/<Configs\s*\/>|<Configs\s+\/>/.test(text)) {
      info.hardware_cfg_entries.push('(empty config)')
      return
    }

    // Find device-like elements with attributes
    const devicePattern = /<(?:\w+:)?\w+\s+([^/]+)\/>/g
    let dm: RegExpExecArray | null

    while ((dm = devicePattern.exec(text)) !== null) {
      const attrStr = dm[1]
      const attrPattern = /(\w+)="([^"]*)"/g
      const attrs: Record<string, string> = {}
      let am: RegExpExecArray | null

      while ((am = attrPattern.exec(attrStr)) !== null) {
        attrs[am[1]] = am[2]
      }

      if (Object.keys(attrs).length === 0) continue

      // Build a description string from key attributes
      const parts: string[] = []
      for (const key of ['name', 'ip', 'address', 'type', 'id', 'serial']) {
        if (attrs[key]) parts.push(`${key}=${attrs[key]}`)
      }
      if (parts.length === 0) {
        // Fallback: use all attributes
        for (const [k, v] of Object.entries(attrs)) {
          parts.push(`${k}=${v}`)
        }
      }
      const entry = parts.join(', ')
      if (entry && !info.hardware_cfg_entries.includes(entry)) {
        info.hardware_cfg_entries.push(entry)
      }
    }
  }

  private _parseRegistry(text: string, info: HardwareServiceInfo): void {
    // Install path
    const pathMatch = /InstallPath.*?REG_SZ\s+(.+)/i.exec(text)
    if (pathMatch) info.install_path = pathMatch[1].trim()

    // Service startup type
    const startMatch = /Start.*?REG_DWORD.*?(0x[\da-f]+|\d+)/i.exec(text)
    if (startMatch) info.service_startup_type = startMatch[1].trim()

    // Rivermax env vars
    const rivermaxRe = /(RIVERMAX_\w+)\s+REG_\w+\s+(.+)/gi
    let rm: RegExpExecArray | null
    while ((rm = rivermaxRe.exec(text)) !== null) {
      info.rivermax_env_vars[rm[1].trim()] = rm[2].trim()
    }

    // Firewall rules
    const firewallRe = /Rule Name:\s*(.+)/gi
    let fm: RegExpExecArray | null
    while ((fm = firewallRe.exec(text)) !== null) {
      const rule = fm[1].trim()
      if (!info.firewall_rules_found.includes(rule)) {
        info.firewall_rules_found.push(rule)
      }
    }
  }
}
