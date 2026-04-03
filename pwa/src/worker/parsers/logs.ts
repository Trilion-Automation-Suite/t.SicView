// ============================================================
// parsers/logs.ts — Port of Python LogsParser
// Scans all log files in gomsicLogDir and zqsGomLogDir
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { LogSummary, LogEntry, LogInventory, LogFileEntry } from '../models'
import { gomsicLogDir, zqsGomLogDir } from '../extractor'

const LOG_PATTERNS = [
  'zi_acq_*.log',
  'GOM-HAL-*.log',
  'GOM-ACQ-*.log',
  'ZEISS_INSPECT-*.log',
  'GOM-*.log',
  'GOMSoftware-*.log',
]

const ERROR_RE = /\bERROR\b|\bFATAL\b|\bTIMEOUT\b|\bFAIL(?:ED|URE)?\b|\bException\b|\bCRITICAL\b/i
const WARN_RE = /\bWARN(?:ING)?\b/i
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/

const CONTEXT_LINES = 3
const MAX_ENTRIES = 500

function describeLogFile(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.includes('zi_acq')) return 'ZEISS 2026 acquisition session log'
  if (lower.includes('gom-hal')) return 'Hardware Abstraction Layer (HAL) log'
  if (lower.includes('gom-acq')) return 'GOM acquisition log'
  if (lower.includes('zeiss_inspect-')) return 'ZEISS INSPECT application log'
  if (lower.includes('gomsoftware')) return 'GOM software log'
  if (lower.includes('gom-')) return 'GOM subsystem log'
  return 'Log file'
}

export class LogsParser extends BaseParser<LogSummary> {
  readonly name = 'logs'
  logInventory: LogInventory | null = null

  parse(ctx: ParserContext): LogSummary | null {
    const { layout } = ctx

    const summary: LogSummary = {
      total_errors: 0,
      total_warnings: 0,
      entries: [],
      files_analyzed: [],
    }

    const inventoryFiles: LogFileEntry[] = []

    // Collect candidate log files from both directories
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
      const bytes = layout.files.get(vpath)
      if (!bytes) continue

      const text = this.decodeAuto(bytes)
      const lines = text.split(/\r?\n/)
      const filename = vpath.split('/').pop() ?? vpath

      summary.files_analyzed.push(vpath)

      let hasErrors = false
      let hasWarnings = false
      let firstTimestamp: string | undefined
      let lastTimestamp: string | undefined

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Track timestamps
        const tsMatch = TIMESTAMP_RE.exec(line)
        if (tsMatch) {
          const ts = tsMatch[1]
          if (!firstTimestamp) firstTimestamp = ts
          lastTimestamp = ts
        }

        let level: string | undefined
        if (ERROR_RE.test(line)) {
          level = 'ERROR'
          hasErrors = true
          summary.total_errors++
        } else if (WARN_RE.test(line)) {
          level = 'WARNING'
          hasWarnings = true
          summary.total_warnings++
        }

        if (level && summary.entries.length < MAX_ENTRIES) {
          const contextBefore = lines.slice(Math.max(0, i - CONTEXT_LINES), i)
          const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 1 + CONTEXT_LINES))

          const entry: LogEntry = {
            timestamp: tsMatch?.[1],
            level,
            source_file: vpath,
            line_number: i + 1,
            message: line.trim(),
            context_before: contextBefore,
            context_after: contextAfter,
          }
          summary.entries.push(entry)
        }
      }

      const inventoryEntry: LogFileEntry = {
        filename,
        path: vpath,
        size_bytes: bytes.length,
        line_count: lines.length,
        has_errors: hasErrors,
        has_warnings: hasWarnings,
        first_timestamp: firstTimestamp,
        last_timestamp: lastTimestamp,
        description: describeLogFile(filename),
      }
      inventoryFiles.push(inventoryEntry)
    }

    if (summary.files_analyzed.length === 0) return null

    this.logInventory = { files: inventoryFiles }
    return summary
  }
}
