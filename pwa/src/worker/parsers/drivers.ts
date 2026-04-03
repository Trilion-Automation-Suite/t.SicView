// ============================================================
// parsers/drivers.ts — Port of Python DriversParser
// Sources: InstalledPrograms.log, nvidia-smi.log, pnputil.log
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { DriverInfo, GPUInfo, InstalledDriver } from '../models'

const RELEVANT_PROGRAMS: [RegExp, string][] = [
  [/MLNX_WinOF2|Mellanox\s+WinOF/i, 'mellanox'],
  [/Rivermax/i, 'rivermax'],
  [/CodeMeter/i, 'codemeter'],
  [/NVIDIA.*Driver|NVIDIA.*Graphics/i, 'nvidia'],
  [/Common\s+Vision\s+Blox/i, 'cvb'],
  [/ZEISS\s+Quality\s+Suite/i, 'zeiss_qzs'],
  [/ZEISS\s+(?:INSPECT|CORRELATE)/i, 'zeiss_inspect'],
  [/ZEISS.*Hardware\s+Service/i, 'zeiss_hw_service'],
  [/MultiDeviceClient/i, 'multidevice'],
  [/Intel.*Network\s+Connections/i, 'intel_net'],
  [/\.NET\s+(?:Desktop\s+)?Runtime\s+-\s+\d/i, 'dotnet'],
  [/Visual\s+C\+\+.*Redistributable.*x64|VC_Redist.*x64/i, 'vcredist'],
  [/Emergent.*Camera|eCapture/i, 'emergent_camera'],
  [/ZEISS\s+CORRELATE|GOM\s+Correlate/i, 'correlate'],
]

export class DriversParser extends BaseParser<DriverInfo> {
  readonly name = 'drivers'

  parse(ctx: ParserContext): DriverInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const info: DriverInfo = {
      all_relevant_drivers: [],
      install_timeline: [],
    }

    // --- Parse InstalledPrograms.log ---
    const installedText = this.getText(layout, `${gomsicDir}/InstalledPrograms.log`)
    if (installedText) {
      this._parseInstalledPrograms(installedText, info)
    }

    // --- Parse nvidia-smi.log ---
    const nvidiaText = this.getText(layout, `${gomsicDir}/nvidia-smi.log`)
    if (nvidiaText) {
      info.gpu = this._parseNvidiaSmi(nvidiaText)
    }

    // Return null only if nothing was found
    if (
      !info.gpu &&
      info.all_relevant_drivers.length === 0 &&
      !info.nvidia_driver &&
      !info.mellanox_driver &&
      !info.rivermax &&
      !info.codemeter
    ) {
      return null
    }

    return info
  }

  private _parseInstalledPrograms(text: string, info: DriverInfo): void {
    // Split on '---' delimiters
    const sections = text.split(/^---\s*$/m)
    // sections[0] = header (starting '...' line)
    // sections[1] = table (header row + data rows)
    // sections[2] = footer (Exit code)
    if (sections.length < 2) return

    const tableSection = sections[1]
    const lines = tableSection.split(/\r?\n/)

    // Find the dash underline row to detect column positions
    interface ColSpan { start: number; end: number; name: string }
    const columns: ColSpan[] = []
    let headerLineIdx = -1
    let dashLineIdx = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^-{2,}/.test(line.trim()) && line.trim().startsWith('-')) {
        dashLineIdx = i
        headerLineIdx = i - 1
        break
      }
    }

    if (dashLineIdx < 0 || headerLineIdx < 0) return

    const dashLine = lines[dashLineIdx]
    const headerLine = lines[headerLineIdx] ?? ''

    // Detect column positions from runs of '-'
    const dashRe = /-+/g
    let dashM: RegExpExecArray | null
    while ((dashM = dashRe.exec(dashLine)) !== null) {
      columns.push({
        start: dashM.index,
        end: dashM.index + dashM[0].length,
        name: '',
      })
    }

    // Map column positions to header names
    for (const col of columns) {
      col.name = headerLine.slice(col.start, col.end).trim().toLowerCase()
    }

    const getColVal = (line: string, colName: string): string => {
      const col = columns.find((c) => c.name === colName)
      if (!col) return ''
      return line.slice(col.start, Math.min(col.end + 20, line.length)).trim()
    }

    // Parse data rows
    for (let i = dashLineIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue

      // Use column positions for name, version, installdate
      const nameCol = columns.find((c) => c.name === 'name')
      const versionCol = columns.find((c) => c.name === 'version')
      const dateCol = columns.find((c) => c.name === 'installdate')

      if (!nameCol) continue

      // For name: read up to the next column start (or end of line if last)
      const nameEnd = versionCol ? versionCol.start : line.length
      const name = line.slice(nameCol.start, nameEnd).trim()
      if (!name) continue

      const versionEnd = dateCol ? dateCol.start : line.length
      const version = versionCol
        ? line.slice(versionCol.start, versionEnd).trim()
        : ''

      const rawDate = dateCol ? line.slice(dateCol.start).split(/\s+/)[0]?.trim() ?? '' : ''
      const installDate = this._formatDate(rawDate)

      const driver: InstalledDriver = {
        name,
        version: version || undefined,
        install_date: installDate || undefined,
      }

      // Classify against known patterns
      for (const [pattern, category] of RELEVANT_PROGRAMS) {
        if (pattern.test(name)) {
          info.all_relevant_drivers.push(driver)
          // Set top-level convenience fields
          switch (category) {
            case 'nvidia':
              if (!info.nvidia_driver) info.nvidia_driver = version
              break
            case 'mellanox':
              if (!info.mellanox_driver) info.mellanox_driver = version
              break
            case 'rivermax':
              if (!info.rivermax) info.rivermax = version
              break
            case 'codemeter':
              if (!info.codemeter) info.codemeter = version
              break
          }
          break
        }
      }
    }

    // Build install_timeline: all matching drivers sorted by date descending
    info.install_timeline = [...info.all_relevant_drivers]
      .filter((d) => d.install_date)
      .sort((a, b) => {
        const da = a.install_date ?? ''
        const db = b.install_date ?? ''
        return db.localeCompare(da)
      })
  }

  private _formatDate(raw: string): string {
    // Format YYYYMMDD → YYYY-MM-DD
    if (/^\d{8}$/.test(raw)) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    }
    return raw
  }

  private _parseNvidiaSmi(text: string): GPUInfo {
    const gpu: GPUInfo = { raw_data: {} }

    const extract = (pattern: RegExp): string | undefined => {
      const m = pattern.exec(text)
      return m ? m[1].trim() : undefined
    }

    gpu.name = extract(/GPU\s+(?:\d+:)?\s*(.+?)(?:\s*\(UUID:|$)/m) ??
      extract(/Product Name\s*:\s*(.+)/i) ??
      extract(/^\|\s+NVIDIA\s+(.*?)\s+\|/m)

    gpu.driver_version = extract(/Driver Version\s*:\s*([\d.]+)/i)
    gpu.cuda_version = extract(/CUDA Version\s*:\s*([\d.]+)/i)
    gpu.memory_total = extract(/(?:FB Memory Usage|Total\s+:|Memory Total)\s*[:\|]\s*(\d+\s*MiB)/i) ??
      extract(/(\d+)\s*MiB\s+Total/i)
    gpu.memory_used = extract(/Used\s*:\s*(\d+\s*MiB)/i)
    gpu.temperature = extract(/(?:GPU\s+)?Temp\s*:\s*(\d+\s*C)/i) ??
      extract(/Temperature.*?(\d+\s*C)/i)
    gpu.power_draw = extract(/Power Draw\s*:\s*([\d.]+\s*W)/i) ??
      extract(/Draw\s*:\s*([\d.]+\s*W)/i)
    gpu.pcie_gen = extract(/PCIe Generation\s*:\s*(\S+)/i)

    // Store raw snippet
    gpu.raw_data['raw_text'] = text.slice(0, 2000)

    return gpu
  }
}
