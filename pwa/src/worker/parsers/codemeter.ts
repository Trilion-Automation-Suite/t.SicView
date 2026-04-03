// ============================================================
// parsers/codemeter.ts — Port of Python CodeMeterParser
// Source: <gomsicDir>/CodeMeter.log
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { CodeMeterInfo, StorageDrive } from '../models'

export class CodeMeterParser extends BaseParser<CodeMeterInfo> {
  readonly name = 'codemeter'

  parse(ctx: ParserContext): CodeMeterInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const vpath = `${gomsicDir}/CodeMeter.log`
    const text = this.getText(layout, vpath)
    if (!text) return null

    const info: CodeMeterInfo = {
      containers: [],
      raw_sections: {},
      drives: [],
    }

    // Version
    const versionMatch = /CodeMeter Runtime Version[:\s]+([\d.]+)/i.exec(text)
    if (versionMatch) {
      info.version = versionMatch[1].trim()
    }

    // Container blocks: match CmContainer lines (dotall handled by iterating)
    // Pattern: CmContainer #N ... Serial: XXXX
    const containerRe = /CmContainer\s+#(\d+)/gi
    const serialRe = /Serial\s*:\s*(\S+)/i
    let cm: RegExpExecArray | null
    while ((cm = containerRe.exec(text)) !== null) {
      const containerNum = cm[1]
      // Look ahead for Serial in the next ~300 chars
      const snippet = text.slice(cm.index, cm.index + 300)
      const serialMatch = serialRe.exec(snippet)
      const entry = serialMatch
        ? `Container #${containerNum} Serial: ${serialMatch[1]}`
        : `Container #${containerNum}`
      if (!info.containers.includes(entry)) {
        info.containers.push(entry)
      }
    }

    // Status detection
    if (/CmContainer.*running|Status.*OK/i.test(text)) {
      info.status = 'OK'
    } else if (/error|fail/i.test(text)) {
      info.status = 'Error'
    }

    // Drive lines
    // e.g.:   C:\ = Fix Drive  (966367 MB, 588600 MB free)
    // e.g.:   E:\ = Removable Drive Bus=Usb;Lexar   USB Flash Drive  (118820 MB, 105124 MB free)
    const driveRe = /^\s+([A-Z]:\\)\s*=\s*(Fix Drive|Removable Drive|Network Drive|CD-ROM Drive)(?:\s+(?:Bus=\S+;)?(.+?))?\s*\((\d+)\s*MB,\s*(\d+)\s*MB free\)/gm
    let dm: RegExpExecArray | null
    while ((dm = driveRe.exec(text)) !== null) {
      const drive: StorageDrive = {
        letter: dm[1],
        drive_type: dm[2],
        label: dm[3]?.trim() || undefined,
        total_mb: parseInt(dm[4]),
        free_mb: parseInt(dm[5]),
      }
      info.drives.push(drive)
    }

    // Store raw text as a section
    info.raw_sections['raw'] = text.slice(0, 5000)

    return info
  }
}
