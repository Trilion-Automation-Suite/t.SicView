// ============================================================
// parsers/gomsoftware-cfg.ts — Port of Python GomSoftwareCfgParser
// Parses T.O.M. brace-delimited config files (gomsoftware.cfg)
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { GomSoftwareConfig } from '../models'
import { gomsicConfigDir } from '../extractor'

export class GomSoftwareCfgParser extends BaseParser<GomSoftwareConfig> {
  readonly name = 'gomsoftware_cfg'

  parse(ctx: ParserContext): GomSoftwareConfig | null {
    const { layout, gomsicDir } = ctx
    if (!gomsicDir) return null

    // Search for gomsoftware.cfg in config directories
    const candidates: string[] = []

    // Try gomsicConfigDir (checks local-config, all-config, config)
    const configDir = gomsicConfigDir(layout)
    if (configDir) {
      const found = this.findFiles(layout, configDir, '*/gomsoftware.cfg')
      candidates.push(...found)
    }

    // Also explicitly try local-config and config if gomsicConfigDir didn't find them
    for (const sub of ['local-config', 'config']) {
      const dir = `${gomsicDir}/${sub}`
      const found = this.findFiles(layout, dir, '*/gomsoftware.cfg')
      for (const f of found) {
        if (!candidates.includes(f)) candidates.push(f)
      }
    }

    if (candidates.length === 0) return null

    // Use the first found file (prefer local-config over config)
    const vpath = candidates[0]
    const text = this.getText(layout, vpath)
    if (!text) return null

    const sections = this._parseTomConfig(text)

    return {
      sections,
      raw_text: text,
    }
  }

  /**
   * Parse T.O.M. brace-delimited config format.
   * Only extracts key=value pairs at depth == 1 (direct children of top-level sections).
   *
   * Example:
   *   section_name {
   *       key = value
   *       subsection {
   *           key = value  <- ignored (depth 2)
   *       }
   *   }
   */
  private _parseTomConfig(text: string): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    let depth = 0
    let currentSection = ''
    const sectionStack: string[] = []

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith('//')) continue

      // Check for opening brace (possibly "name {" on same line)
      if (line.includes('{')) {
        const nameMatch = line.match(/^(\S+)\s*\{/)
        const sectionName = nameMatch ? nameMatch[1] : ''

        if (depth === 0) {
          currentSection = sectionName
          if (currentSection && !(currentSection in result)) {
            result[currentSection] = {}
          }
          sectionStack.push(currentSection)
        } else {
          sectionStack.push(sectionName)
        }
        depth++
        continue
      }

      // Closing brace
      if (line === '}') {
        if (depth > 0) {
          sectionStack.pop()
          depth--
          if (depth === 0) {
            currentSection = ''
          }
        }
        continue
      }

      // Key=value pair — only extract at depth 1 (direct section children)
      if (depth === 1 && currentSection && line.includes('=')) {
        const eqIdx = line.indexOf('=')
        const key = line.slice(0, eqIdx).trim()
        const value = line.slice(eqIdx + 1).trim()
        if (key) {
          result[currentSection][key] = this._parseValue(value)
        }
      }
    }

    return result
  }

  /**
   * Attempt to coerce values to appropriate types.
   * Strings that look like numbers become numbers; "true"/"false" become booleans.
   */
  private _parseValue(raw: string): unknown {
    // Strip surrounding quotes
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1)
    }
    if (raw.toLowerCase() === 'true') return true
    if (raw.toLowerCase() === 'false') return false
    const num = Number(raw)
    if (!isNaN(num) && raw.length > 0) return num
    return raw
  }
}
