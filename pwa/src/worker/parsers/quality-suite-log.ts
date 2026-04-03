// ============================================================
// parsers/quality-suite-log.ts — Port of Python QualitySuiteLogParser
// Source: ZQS/QualitySuite/user/Suite.log (log4j XML events)
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { QualitySuiteLogSummary, QualitySuiteLogEntry } from '../models'

const LEVELS_TO_KEEP = new Set(['ERROR', 'WARN', 'WARNING', 'FATAL'])

// log4j XML event pattern (dotall via /s flag)
const EVENT_RE =
  /<log4j:event\s+logger="([^"]*?)"\s+level="([^"]*?)"\s+timestamp="(\d+)"\s+thread="([^"]*?)">(.*?)<\/log4j:event>/gs
const MSG_RE = /<log4j:message>(.*?)<\/log4j:message>/s
const THROWABLE_RE = /<log4j:throwable>(.*?)<\/log4j:throwable>/s
const DATA_RE = /<log4j:data\s+name="([^"]*?)"\s+value="([^"]*?)"\s*\/>/g

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export class QualitySuiteLogParser extends BaseParser<QualitySuiteLogSummary> {
  readonly name = 'quality_suite_log'

  parse(ctx: ParserContext): QualitySuiteLogSummary | null {
    const { layout } = ctx

    const summary: QualitySuiteLogSummary = {
      entries: [],
      total_errors: 0,
      total_warnings: 0,
      files_analyzed: [],
    }

    // ZQS dir paths for Suite.log
    const zqsDir = layout.zqsDir
    if (!zqsDir) return null

    const candidatePaths = [
      `${zqsDir}/QualitySuite/user/Suite.log`,
      `${zqsDir}/QualitySuite/Administrator/Suite.log`,
    ]

    let foundAny = false

    for (const vpath of candidatePaths) {
      const text = this.getText(layout, vpath)
      if (!text) continue

      foundAny = true
      summary.files_analyzed.push(vpath)

      // Reset regex lastIndex before each file
      EVENT_RE.lastIndex = 0

      let em: RegExpExecArray | null
      while ((em = EVENT_RE.exec(text)) !== null) {
        const logger = em[1]
        const level = em[2].toUpperCase()
        const timestampMs = parseInt(em[3])
        const thread = em[4]
        const innerXml = em[5]

        if (!LEVELS_TO_KEEP.has(level)) continue

        // Extract message
        MSG_RE.lastIndex = 0
        const msgMatch = MSG_RE.exec(innerXml)
        const message = msgMatch ? unescapeXml(msgMatch[1].trim()) : ''

        // Extract throwable
        THROWABLE_RE.lastIndex = 0
        const throwMatch = THROWABLE_RE.exec(innerXml)
        const exception = throwMatch ? unescapeXml(throwMatch[1].trim()) : undefined

        // Extract properties
        const properties: Record<string, unknown> = {}
        DATA_RE.lastIndex = 0
        let dm: RegExpExecArray | null
        while ((dm = DATA_RE.exec(innerXml)) !== null) {
          properties[dm[1]] = unescapeXml(dm[2])
        }

        // Convert timestamp (milliseconds since epoch) to ISO string
        let timestamp: string | undefined
        if (!isNaN(timestampMs)) {
          try {
            timestamp = new Date(timestampMs).toISOString()
          } catch {
            timestamp = undefined
          }
        }

        const entry: QualitySuiteLogEntry = {
          timestamp,
          level,
          logger,
          message,
          exception,
          thread,
          properties,
        }

        summary.entries.push(entry)

        if (level === 'ERROR' || level === 'FATAL') {
          summary.total_errors++
        } else if (level === 'WARN' || level === 'WARNING') {
          summary.total_warnings++
        }
      }
    }

    if (!foundAny) return null
    return summary
  }
}
