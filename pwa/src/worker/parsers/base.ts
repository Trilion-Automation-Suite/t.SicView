// ============================================================
// parsers/base.ts — Abstract base class for all parsers
// ============================================================

import type { ArchiveLayout } from '../extractor'
import type { ParserTrace } from '../models'

export interface ParserContext {
  layout: ArchiveLayout
  trace: ParserTrace
  /** Convenience shortcut: layout.gomsicDir */
  gomsicDir?: string
}

export abstract class BaseParser<T> {
  abstract readonly name: string

  abstract parse(ctx: ParserContext): T | null

  protected getText(layout: ArchiveLayout, vpath: string): string | null {
    const bytes = layout.files.get(vpath)
    if (!bytes) return null
    return this.decodeAuto(bytes)
  }

  protected getUtf16(layout: ArchiveLayout, vpath: string): string | null {
    const bytes = layout.files.get(vpath)
    if (!bytes) return null
    return this.decodeUtf16(bytes)
  }

  /**
   * Auto-detect encoding: check for BOM first (UTF-16 LE/BE, UTF-8 BOM),
   * then fall back to UTF-8 with error recovery.
   */
  protected decodeAuto(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.slice(2))
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.slice(2))
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.slice(3))
    }
    try {
      return new TextDecoder('utf-8').decode(bytes)
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    }
  }

  /**
   * Decode as UTF-16 (with or without BOM).
   * Falls back to lossy UTF-8 if decoding fails.
   */
  protected decodeUtf16(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.slice(2))
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.slice(2))
    }
    // Try UTF-16 LE without BOM first (common for msinfo32.log)
    try {
      return new TextDecoder('utf-16le').decode(bytes)
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    }
  }

  /**
   * Find all virtual paths whose filename relative to `dir` matches `pattern`.
   * Supports `*` (single path segment) and `**` (any depth).
   */
  protected findFiles(layout: ArchiveLayout, dir: string, pattern: string): string[] {
    const prefix = dir.endsWith('/') ? dir : dir + '/'
    const regex = this.globToRegex(pattern)
    const results: string[] = []
    for (const key of layout.files.keys()) {
      if (key.startsWith(prefix)) {
        const rel = key.slice(prefix.length)
        if (regex.test(rel)) results.push(key)
      }
    }
    return results.sort()
  }

  protected globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__DOUBLESTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DOUBLESTAR__/g, '.*')
    return new RegExp('^' + escaped + '$')
  }
}
