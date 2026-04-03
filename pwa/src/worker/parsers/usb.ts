// ============================================================
// parsers/usb.ts — Port of Python USBParser
// Reads <gomsicDir>/msinfo32.log (UTF-16), extracts [USB] section
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { USBInfo, USBDevice } from '../models'

export class USBParser extends BaseParser<USBInfo> {
  readonly name = 'usb'

  parse(ctx: ParserContext): USBInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const vpath = `${gomsicDir}/msinfo32.log`
    const bytes = layout.files.get(vpath)
    if (!bytes) return null

    // msinfo32.log is UTF-16 LE
    const text = this.getUtf16(layout, vpath) ?? this.decodeAuto(bytes)
    if (!text) return null

    // Find [USB] section
    const usbSectionMatch = text.match(/\[USB\]([\s\S]*?)(?=\[|$)/i)
    if (!usbSectionMatch) return null

    const usbSection = usbSectionMatch[1]
    const devices: USBDevice[] = []

    for (const line of usbSection.split(/\r?\n/)) {
      const stripped = line.trim()
      if (!stripped) continue

      // Skip header row (contains "Name" and "Device ID" as column labels)
      if (/^name\s*\t/i.test(stripped) || stripped.toLowerCase() === 'name') continue
      if (/^item\s*\t/i.test(stripped)) continue

      // Tab-delimited: name[0], device_id[1], status[2]
      const parts = stripped.split('\t').map((p) => p.trim())
      if (parts.length === 0 || !parts[0]) continue

      const device: USBDevice = {
        name: parts[0],
        device_id: parts[1] ?? undefined,
        status: parts[2] ?? undefined,
      }

      // Skip rows that look like column headers
      if (
        parts[0].toLowerCase() === 'name' ||
        parts[0].toLowerCase() === 'item'
      ) {
        continue
      }

      devices.push(device)
    }

    if (devices.length === 0) return null

    return { devices }
  }
}
