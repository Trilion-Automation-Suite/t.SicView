// ============================================================
// parsers/activity-timeline.ts — Port of Python ActivityTimelineParser
// Sources: ZEISS_INSPECT-*.log and GOMSoftware-*.log in gomsicLogDir
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { ActivityTimeline, ActivityEvent } from '../models'
import { gomsicLogDir } from '../extractor'

// executing module.command (args...) at DayOfWeek Mon DD HH:MM:SS YYYY
const EXECUTING_RE =
  /^executing\s+(\S+)\s+(?:\(([^)]*(?:\([^)]*\))*[^)]*)\)\s+)?(?:from menu\s+)?at\s+(.+\d{4})$/gm

// save working copy
const SAVE_WC_RE = /^save working copy started at\s+(.+\d{4})$/gm

// application hang
const HANG_RE = /^recovered from application hang #(\d+)/gm

// exit
const EXIT_RE = /^Exit-code:\s*(\d+)/gm
const END_TIME_RE = /^End time:\s*(.+?)\s+\(elapsed:\s*(\d+)\s*s\)/gm

// Command categorization: command → [category, label]
const COMMAND_CATEGORIES: Record<string, [string, string]> = {
  'sys.save_project': ['project', 'Project saved'],
  'sys.show_stage': ['navigation', 'Stage changed'],
  'sys.start_acquisition': ['acquisition', 'Acquisition started'],
  'sys.stop_acquisition': ['acquisition', 'Acquisition stopped'],
  'sys.open_project': ['project', 'Project opened'],
  'sys.close_project': ['project', 'Project closed'],
  'sys.new_project': ['project', 'New project created'],
  'sys.save_project_as': ['project', 'Project saved as'],
  'sys.import': ['import', 'Import started'],
  'sys.export': ['export', 'Export started'],
  'sys.create_element': ['element', 'Element created'],
  'sys.delete_element': ['element', 'Element deleted'],
  'sys.recalculate': ['computation', 'Recalculation triggered'],
  'sys.run_script': ['script', 'Script executed'],
  'sys.switch_to_project': ['project', 'Switched project'],
  'sys.undo': ['edit', 'Undo'],
  'sys.redo': ['edit', 'Redo'],
  'sys.print_report': ['report', 'Report printed'],
  'sys.export_report': ['report', 'Report exported'],
  'sys.calibrate': ['calibration', 'Calibration run'],
  'sys.check_calibration': ['calibration', 'Calibration check'],
  'sys.connect_sensor': ['hardware', 'Sensor connected'],
  'sys.disconnect_sensor': ['hardware', 'Sensor disconnected'],
  'sys.start_live': ['acquisition', 'Live view started'],
  'sys.stop_live': ['acquisition', 'Live view stopped'],
  'sys.take_reference': ['acquisition', 'Reference taken'],
  'sys.set_measuring_volume': ['hardware', 'Measuring volume set'],
  'sys.align': ['computation', 'Alignment run'],
  'sys.check_point': ['computation', 'Check point evaluated'],
  'sys.add_stage': ['navigation', 'Stage added'],
  'sys.remove_stage': ['navigation', 'Stage removed'],
  'sys.rename_stage': ['navigation', 'Stage renamed'],
  'sys.rename_element': ['element', 'Element renamed'],
}

export class ActivityTimelineParser extends BaseParser<ActivityTimeline> {
  readonly name = 'activity_timeline'

  parse(ctx: ParserContext): ActivityTimeline | null {
    const { layout } = ctx

    const timeline: ActivityTimeline = {
      events: [],
      hang_count: 0,
      total_commands: 0,
      command_summary: {},
    }

    const logDir = gomsicLogDir(layout)
    if (!logDir) return null

    const logFiles: string[] = []
    for (const pattern of ['ZEISS_INSPECT-*.log', 'GOMSoftware-*.log']) {
      const found = this.findFiles(layout, logDir, pattern)
      logFiles.push(...found)
    }

    if (logFiles.length === 0) return null

    for (const vpath of logFiles) {
      const text = this.getText(layout, vpath)
      if (!text) continue

      this._parseLogFile(text, vpath, timeline)
    }

    if (timeline.events.length === 0 && timeline.total_commands === 0) return null

    // Sort events by timestamp descending (most recent first)
    timeline.events.sort((a, b) => {
      const ta = a.timestamp ?? ''
      const tb = b.timestamp ?? ''
      return tb.localeCompare(ta)
    })

    // Set last_action: first event with non-empty timestamp and non-navigation category
    const lastActionEvent = timeline.events.find(
      (e) => e.timestamp && e.category !== 'navigation',
    )
    if (lastActionEvent) {
      timeline.last_action = `${lastActionEvent.action}: ${lastActionEvent.detail}`.trim()
    }

    return timeline
  }

  private _parseLogFile(text: string, vpath: string, timeline: ActivityTimeline): void {
    // executing commands
    EXECUTING_RE.lastIndex = 0
    let em: RegExpExecArray | null
    while ((em = EXECUTING_RE.exec(text)) !== null) {
      const command = em[1]
      const args = em[2]?.trim() ?? ''
      const timestampRaw = em[3]?.trim() ?? ''

      timeline.total_commands++
      timeline.command_summary[command] = (timeline.command_summary[command] ?? 0) + 1

      const [category, label] = COMMAND_CATEGORIES[command] ?? ['other', command]

      // Skip navigation events from the events list (count only)
      if (category === 'navigation' && command === 'sys.show_stage') {
        timeline.stage_count = (timeline.stage_count ?? 0) + 1
        continue
      }

      const event: ActivityEvent = {
        timestamp: this._normalizeTimestamp(timestampRaw),
        category,
        action: label,
        detail: args ? args.slice(0, 200) : command,
        source_file: vpath,
      }
      timeline.events.push(event)
    }

    // Save working copy events
    SAVE_WC_RE.lastIndex = 0
    let sm: RegExpExecArray | null
    while ((sm = SAVE_WC_RE.exec(text)) !== null) {
      const event: ActivityEvent = {
        timestamp: this._normalizeTimestamp(sm[1].trim()),
        category: 'project',
        action: 'Working copy saved',
        detail: '',
        source_file: vpath,
      }
      timeline.events.push(event)
    }

    // Hang events
    HANG_RE.lastIndex = 0
    let hm: RegExpExecArray | null
    while ((hm = HANG_RE.exec(text)) !== null) {
      timeline.hang_count++
      const event: ActivityEvent = {
        timestamp: undefined,
        category: 'error',
        action: 'Application hang recovered',
        detail: `Hang #${hm[1]}`,
        source_file: vpath,
      }
      timeline.events.push(event)
    }

    // Exit events
    END_TIME_RE.lastIndex = 0
    EXIT_RE.lastIndex = 0
    // Pair up exit code and end time in sequence
    const exitCodes: string[] = []
    let xm: RegExpExecArray | null
    while ((xm = EXIT_RE.exec(text)) !== null) {
      exitCodes.push(xm[1])
    }
    let etIdx = 0
    END_TIME_RE.lastIndex = 0
    let etm: RegExpExecArray | null
    while ((etm = END_TIME_RE.exec(text)) !== null) {
      const exitCode = exitCodes[etIdx++] ?? '?'
      const event: ActivityEvent = {
        timestamp: this._normalizeTimestamp(etm[1].trim()),
        category: 'session',
        action: 'Application exit',
        detail: `Exit code ${exitCode}, elapsed ${etm[2]}s`,
        source_file: vpath,
      }
      timeline.events.push(event)
    }
  }

  /**
   * Try to produce a sortable ISO-ish timestamp from the log format:
   * "DayOfWeek Mon DD HH:MM:SS YYYY" (e.g. "Thu Jan 16 09:14:22 2026")
   */
  private _normalizeTimestamp(raw: string): string | undefined {
    if (!raw) return undefined

    // Already ISO-like (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw

    // "Thu Jan 16 09:14:22 2026"
    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) {
        return d.toISOString()
      }
    } catch {
      // fall through
    }

    return raw
  }
}
