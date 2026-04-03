// ============================================================
// parsers/system-info.ts — Port of Python SystemInfoParser
// Parses <gomsicDir>/msinfo32.log (UTF-16 LE)
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { SystemInfo } from '../models'
import type { ArchiveLayout } from '../extractor'

export class SystemInfoParser extends BaseParser<SystemInfo> {
  readonly name = 'system_info'

  parse(ctx: ParserContext): SystemInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const vpath = `${gomsicDir}/msinfo32.log`
    const bytes = layout.files.get(vpath)
    if (!bytes) return null

    // msinfo32.log is UTF-16 LE
    const text = this.getUtf16(layout, vpath) ?? this.decodeAuto(bytes)
    if (!text) return null

    const sections = this.parseSections(text)
    const info: SystemInfo = {
      problem_devices: [],
      display_info: {},
      environment_variables: {},
      sections,
    }

    // Extract from System Summary section
    const SYSTEM_FIELDS: Record<string, keyof SystemInfo> = {
      'os name': 'os_name',
      'version': 'os_version',
      'os version': 'os_version',
      'system name': 'computer_name',
      'computer name': 'computer_name',
      'system manufacturer': 'system_manufacturer',
      'system model': 'system_model',
      'processor': 'processor',
      'total physical memory': 'total_physical_memory',
      'installed physical memory': 'total_physical_memory',
      'bios version/date': 'bios_version',
      'bios version': 'bios_version',
      'baseboard product': 'baseboard_product',
    }

    const summaryRows =
      sections['System Summary'] ??
      sections['Systemuebersicht'] ??
      sections[''] ??
      Object.values(sections)[0] ??
      []

    for (const row of summaryRows) {
      const item = (row['Item'] ?? '').toLowerCase()
      const value = row['Value'] ?? ''
      for (const [k, attr] of Object.entries(SYSTEM_FIELDS)) {
        if (item.includes(k) && !info[attr]) {
          ;(info as unknown as Record<string, unknown>)[attr] = value
        }
      }
    }

    // Problem Devices
    const problemRows =
      sections['Problem Devices'] ?? sections['Problemgeraete'] ?? []
    const problems: string[] = []
    for (const row of problemRows) {
      const device = row['Item'] ?? ''
      const detail = row['Value'] ?? ''
      if (device && !['device', 'item', ''].includes(device.toLowerCase())) {
        if (
          !['pnp device id', 'error code', 'value', ''].includes(
            detail.toLowerCase(),
          )
        ) {
          problems.push(detail ? `${device}: ${detail}` : device)
        } else if (device.toLowerCase() !== 'device') {
          problems.push(device)
        }
      }
    }
    info.problem_devices = problems

    // Display info
    for (const [secName, rows] of Object.entries(sections)) {
      if (secName.toLowerCase().includes('display')) {
        const di: Record<string, string> = {}
        for (const row of rows) {
          const item = (row['Item'] ?? '').toLowerCase()
          const value = row['Value'] ?? ''
          if (
            item.includes('adapter description') ||
            (item.includes('name') && item.includes('adapter'))
          ) {
            if (!di['name']) di['name'] = value
          } else if (item.includes('adapter ram')) {
            di['memory'] = value
          } else if (item.includes('driver version')) {
            di['driver_version'] = value
          } else if (item.includes('resolution')) {
            di['resolution'] = value
          }
        }
        if (Object.keys(di).length) {
          info.display_info = di
          break
        }
      }
    }

    // Environment Variables
    for (const [secName, rows] of Object.entries(sections)) {
      if (
        secName.toLowerCase().includes('environment') &&
        secName.toLowerCase().includes('variable')
      ) {
        const env: Record<string, string> = {}
        for (const row of rows) {
          env[row['Item'] ?? ''] = row['Value'] ?? ''
        }
        info.environment_variables = env
        break
      }
    }

    return info
  }

  private parseSections(text: string): Record<string, Record<string, string>[]> {
    const sections: Record<string, Record<string, string>[]> = {}
    let currentSection = ''
    let currentRows: Record<string, string>[] = []
    const headerRows: Record<string, string>[] = []

    for (const line of text.split(/\r?\n/)) {
      const stripped = line.trim()
      if (!stripped) continue

      const secMatch = stripped.match(/^\[(.+)\]\s*$/)
      if (secMatch) {
        if (currentRows.length) sections[currentSection] = currentRows
        else if (headerRows.length && !currentSection)
          sections['_header'] = headerRows
        currentSection = secMatch[1]
        currentRows = []
        continue
      }

      const parts = line
        .split('\t')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length >= 2) {
        currentRows.push({ Item: parts[0], Value: parts[1] })
      } else if (parts.length === 1) {
        const colonM = parts[0].match(/^(.+?):\s*(.+)$/)
        if (colonM) {
          const row = { Item: colonM[1].trim(), Value: colonM[2].trim() }
          if (currentSection) currentRows.push(row)
          else headerRows.push(row)
        } else if (parts[0] && parts[0] !== 'Item') {
          if (currentSection) currentRows.push({ Item: parts[0], Value: '' })
        }
      }
    }
    if (currentRows.length) sections[currentSection] = currentRows
    if (headerRows.length && !('_header' in sections))
      sections['_header'] = headerRows
    return sections
  }
}
