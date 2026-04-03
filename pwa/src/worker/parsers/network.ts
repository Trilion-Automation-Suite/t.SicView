// ============================================================
// parsers/network.ts — Port of Python NetworkParser
// Parses <gomsicDir>/nics.log
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { NetworkInfo, NetworkAdapter } from '../models'

export class NetworkParser extends BaseParser<NetworkInfo> {
  readonly name = 'network'

  parse(ctx: ParserContext): NetworkInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const vpath = `${gomsicDir}/nics.log`
    const text = this.getText(layout, vpath)
    if (!text) return null

    // Split file into sections on "starting '...' with arguments '...'" headers
    const sectionSplitRe = /^starting\s+'[^']+'\s+with arguments\s+'[^']*'\s*$/m
    const rawSections = text.split(sectionSplitRe)

    // rawSections[0] is anything before first header (usually empty)
    // rawSections[1] = ipconfig section
    // rawSections[2] = netsh section
    // rawSections[3] = powershell section
    const ipconfigSection = rawSections[1] ?? ''
    const netshSection = rawSections[2] ?? ''
    const powershellSection = rawSections[3] ?? ''

    const info: NetworkInfo = {
      adapters: [],
      dns_servers: [],
    }

    // Parse ipconfig /all
    const adapters = this._parseIpconfig(ipconfigSection)
    info.adapters = adapters

    // Extract hostname/domain from ipconfig header block (before first adapter)
    const headerMatch = ipconfigSection.match(/^([\s\S]*?)(?=\S.*?(?:adapter|Adapter)\s)/m)
    if (headerMatch) {
      const headerText = headerMatch[1]
      const hostMatch = headerText.match(/Host Name[.\s]+:\s+(.+)/i)
      if (hostMatch) info.hostname = hostMatch[1].trim()
      const domainMatch = headerText.match(/(?:Primary DNS Suffix|Connection-specific DNS Suffix)[.\s]+:\s+(.+)/i)
      if (domainMatch && domainMatch[1].trim()) info.domain = domainMatch[1].trim()
      const dnsMatch = headerText.match(/DNS Servers[.\s]+:\s+(.+)/i)
      if (dnsMatch) info.dns_servers = [dnsMatch[1].trim()]
    }

    // Parse netsh interface table
    this._parseNetsh(netshSection, adapters)

    // Parse PowerShell advanced properties
    this._parsePowershell(powershellSection, adapters)

    return info
  }

  private _parseIpconfig(text: string): NetworkAdapter[] {
    const adapters: NetworkAdapter[] = []

    // Split on adapter headers: lines ending with ":"  that contain "adapter"
    const adapterHeaderRe = /^(\S.*?(?:adapter|Adapter)\s+.+?):\s*$/gm
    const headerMatches: Array<{ name: string; index: number }> = []
    let m: RegExpExecArray | null
    while ((m = adapterHeaderRe.exec(text)) !== null) {
      headerMatches.push({ name: m[1].trim(), index: m.index })
    }

    for (let i = 0; i < headerMatches.length; i++) {
      const { name, index } = headerMatches[i]
      const nextIndex =
        i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length
      const block = text.slice(index, nextIndex)

      const adapter: NetworkAdapter = {
        name,
        ip_addresses: [],
        subnet_masks: [],
        dns_servers: [],
        advanced_properties: {},
      }

      // Parse key-value lines: "   Key . . . . . : Value"
      const kvRe = /^[ \t]+(.+?[^ .])[ .]+:\s*(.+?)\s*$/gm
      let kv: RegExpExecArray | null
      while ((kv = kvRe.exec(block)) !== null) {
        const key = kv[1].trim()
        const value = kv[2].trim()
        const keyLower = key.toLowerCase()

        if (keyLower.includes('description')) {
          if (!adapter.description) adapter.description = value
        } else if (keyLower.includes('physical address')) {
          adapter.mac_address = value
        } else if (keyLower.includes('ipv4 address') || keyLower.includes('ip address')) {
          // Strip "(Preferred)" suffix
          adapter.ip_addresses.push(value.replace(/\s*\(Preferred\)/i, '').trim())
        } else if (keyLower.includes('subnet mask')) {
          adapter.subnet_masks.push(value)
        } else if (keyLower.includes('default gateway')) {
          if (!adapter.default_gateway) adapter.default_gateway = value
        } else if (keyLower.includes('dhcp enabled')) {
          adapter.dhcp_enabled =
            /^(yes|ja|true)$/i.test(value)
        } else if (keyLower.includes('dns servers')) {
          adapter.dns_servers.push(value)
        } else if (keyLower.includes('link-local ipv6') || keyLower.includes('link speed')) {
          adapter.link_speed = value
        }
      }

      adapters.push(adapter)
    }

    return adapters
  }

  private _parseNetsh(text: string, adapters: NetworkAdapter[]): void {
    // Fixed-width table rows: idx met mtu state name
    // Format: "  1          75  4294967295  connected     Loopback Pseudo-Interface 1"
    const rowRe = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/gm
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(text)) !== null) {
      const mtu = m[3]
      const state = m[4]
      const name = m[5].trim()

      // Match to an existing adapter by name substring
      const adapter = this._findAdapterByName(adapters, name)
      if (adapter) {
        adapter.advanced_properties['mtu'] = mtu
        adapter.advanced_properties['state'] = state
      }
    }
  }

  private _parsePowershell(text: string, adapters: NetworkAdapter[]): void {
    if (!text.trim()) return

    const lines = text.split(/\r?\n/)

    // Find header line containing both "ValueName" and "ifAlias"
    let headerLineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes('ValueName') &&
        lines[i].includes('ifAlias')
      ) {
        headerLineIdx = i
        break
      }
    }
    if (headerLineIdx < 0) return

    const headerLine = lines[headerLineIdx]

    // Find dash underline row
    let dashLineIdx = -1
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      if (/^[-\s]+$/.test(lines[i]) && lines[i].includes('-')) {
        dashLineIdx = i
        break
      }
    }
    if (dashLineIdx < 0) return

    const dashLine = lines[dashLineIdx]

    // Detect column positions from runs of '-'
    interface ColSpan { start: number; end: number; name: string }
    const columns: ColSpan[] = []
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
      col.name = headerLine.slice(col.start, col.end).trim()
    }

    const getCol = (line: string, colName: string): string => {
      const col = columns.find((c) => c.name.toLowerCase() === colName.toLowerCase())
      if (!col) return ''
      return line.slice(col.start, col.end).trim()
    }

    // Parse data rows
    for (let i = dashLineIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      if (line.trim().startsWith('starting ')) break

      let valueName = getCol(line, 'ValueName')
      let valueData = getCol(line, 'ValueData')
      const ifAlias = getCol(line, 'ifAlias')

      if (!valueName && !ifAlias) continue

      // Strip '*' prefix from ValueName
      valueName = valueName.replace(/^\*/, '')
      // Strip '{}' from ValueData
      valueData = valueData.replace(/^\{/, '').replace(/\}$/, '')

      if (!ifAlias) continue

      // Match adapter by short name (strip prefix labels)
      const adapterName = ifAlias
        .replace(/^Ethernet adapter\s+/i, '')
        .replace(/^Wireless LAN adapter\s+/i, '')
        .trim()

      const adapter = this._findAdapterByName(adapters, adapterName)
      if (adapter && valueName) {
        adapter.advanced_properties[valueName] = valueData
      }
    }
  }

  private _findAdapterByName(
    adapters: NetworkAdapter[],
    name: string,
  ): NetworkAdapter | undefined {
    const nameLower = name.toLowerCase()
    // Exact match first
    let found = adapters.find((a) => a.name.toLowerCase() === nameLower)
    if (found) return found
    // Partial match: adapter name contains search name or vice versa
    found = adapters.find(
      (a) =>
        a.name.toLowerCase().includes(nameLower) ||
        nameLower.includes(a.name.toLowerCase()),
    )
    return found
  }
}
