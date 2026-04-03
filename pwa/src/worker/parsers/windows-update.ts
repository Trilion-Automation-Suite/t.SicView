// ============================================================
// parsers/windows-update.ts — Port of Python WindowsUpdateParser
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { WindowsUpdateInfo } from '../models'
import type { ArchiveLayout } from '../extractor'

export class WindowsUpdateParser extends BaseParser<WindowsUpdateInfo> {
  readonly name = 'windows_updates'

  parse(ctx: ParserContext): WindowsUpdateInfo | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    const result: WindowsUpdateInfo = {
      installed_updates: [],
      pending_updates: [],
    }

    // Parse Windows10Update.log
    this._parseUpdateLog(layout, gomsicDir, result)

    // Parse WindowsReliabilityRecords.log
    this._parseReliabilityLog(layout, gomsicDir, result)

    if (
      result.installed_updates.length === 0 &&
      result.pending_updates.length === 0
    ) {
      return null
    }

    return result
  }

  private _parseUpdateLog(
    layout: ArchiveLayout,
    gomsicDir: string,
    result: WindowsUpdateInfo,
  ): void {
    const vpath = `${gomsicDir}/Windows10Update.log`
    // Try via getText (auto encoding)
    const bytes = layout.files.get(vpath)
    if (!bytes) return

    const text = this.decodeAuto(bytes)
    if (!text) return

    const seen = new Set<string>()

    for (const line of text.split(/\r?\n/)) {
      const stripped = line.trim()
      if (!stripped) continue

      // Extract KB article number
      const kbMatch = stripped.match(/KB(\d{6,8})/i)
      if (!kbMatch) continue

      const kb = `KB${kbMatch[1]}`

      // Extract date: MM/DD/YYYY or YYYY-MM-DD
      let date = ''
      const dateMatch1 = stripped.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
      const dateMatch2 = stripped.match(/(\d{4}-\d{2}-\d{2})/)
      if (dateMatch1) date = dateMatch1[1]
      else if (dateMatch2) date = dateMatch2[1]

      // Extract title: first part of multi-space split (before 2+ spaces)
      // Often format: "Date  Title  KB  Status"
      // Use multi-space split to get title candidate
      const parts = stripped.split(/\s{2,}/)
      let title = ''
      for (const part of parts) {
        if (!part.includes('KB') && part.length > 5 && !/^\d+$/.test(part)) {
          title = part.trim()
          break
        }
      }

      // Build update string
      let updateStr = kb
      if (date) updateStr = `${date} — ${updateStr}`
      if (title) updateStr = `${updateStr}: ${title}`

      if (!seen.has(kb)) {
        seen.add(kb)
        result.installed_updates.push(updateStr)
      }
    }
  }

  private _parseReliabilityLog(
    layout: ArchiveLayout,
    gomsicDir: string,
    result: WindowsUpdateInfo,
  ): void {
    const vpath = `${gomsicDir}/WindowsReliabilityRecords.log`
    const bytes = layout.files.get(vpath)
    if (!bytes) return

    const text = this.decodeAuto(bytes)
    if (!text) return

    // Look for pending update indicators in reliability records
    // Reliability records often contain "Windows Update" entries with failure info
    for (const line of text.split(/\r?\n/)) {
      const stripped = line.trim()
      if (!stripped) continue

      // Look for KB references in pending/failed context
      if (
        /pending|failed|error/i.test(stripped) &&
        /KB\d{6,8}/i.test(stripped)
      ) {
        const kbMatch = stripped.match(/KB(\d{6,8})/i)
        if (kbMatch) {
          const kb = `KB${kbMatch[1]}`
          if (!result.pending_updates.includes(kb)) {
            result.pending_updates.push(kb)
          }
        }
      }
    }
  }
}
