// ============================================================
// extractor.ts — In-memory archive extractor using fflate
// Supports .zip (with embedded gomsic.tgz) and .tgz/.tar.gz
// ============================================================

import { unzipSync, decompressSync } from 'fflate'

export interface ArchiveLayout {
  /** Virtual path → raw bytes */
  files: Map<string, Uint8Array>
  /** e.g. "gomsic_extracted/2026-01-16-12-22-42" */
  gomsicDir?: string
  /** "ZQS" */
  zqsDir?: string
  /** "ZEISS-INSPECT" */
  zeissInspectDir?: string
  descriptionTxt?: Uint8Array
  warnings: string[]
}

// ---- Path helper functions (mirroring Python @property methods) ----

export function gomsicLogDir(l: ArchiveLayout): string | undefined {
  if (!l.gomsicDir) return undefined
  const candidate = `${l.gomsicDir}/log`
  return hasDir(l.files, candidate) ? candidate : undefined
}

export function zqsLicenseDir(l: ArchiveLayout): string | undefined {
  if (!l.zqsDir) return undefined
  const candidate = `${l.zqsDir}/License`
  return hasDir(l.files, candidate) ? candidate : undefined
}

export function zqsInstalledSoftwareDir(l: ArchiveLayout): string | undefined {
  if (!l.zqsDir) return undefined
  const candidate = `${l.zqsDir}/InstalledSoftware`
  return hasDir(l.files, candidate) ? candidate : undefined
}

export function zqsGomLogDir(l: ArchiveLayout): string | undefined {
  if (!l.zqsDir) return undefined
  const candidate = `${l.zqsDir}/gom/log`
  return hasDir(l.files, candidate) ? candidate : undefined
}

export function gomsicConfigDir(l: ArchiveLayout): string | undefined {
  if (!l.gomsicDir) return undefined
  for (const sub of ['local-config', 'all-config', 'config']) {
    const candidate = `${l.gomsicDir}/${sub}`
    if (hasDir(l.files, candidate)) return candidate
  }
  return undefined
}

// ---- Internal helpers ----

function hasDir(files: Map<string, Uint8Array>, prefix: string): boolean {
  const p = prefix.endsWith('/') ? prefix : prefix + '/'
  for (const k of files.keys()) {
    if (k.startsWith(p)) return true
  }
  return false
}

/**
 * Minimal synchronous TAR parser.
 * 512-byte POSIX headers: name[0..99], size[124..135] (octal ASCII), typeflag[156].
 */
function untarSync(tarBytes: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + 512 <= tarBytes.length) {
    // Read name (null-terminated, up to 100 bytes)
    let nameEnd = 0
    while (nameEnd < 100 && tarBytes[offset + nameEnd] !== 0) nameEnd++
    const name = new TextDecoder('utf-8', { fatal: false }).decode(
      tarBytes.subarray(offset, offset + nameEnd),
    )

    // An empty name (all-zero block) signals end of archive
    if (!name) break

    // Read size in octal ASCII (bytes 124–135)
    let sizeStr = ''
    for (let i = 124; i < 136; i++) {
      const ch = tarBytes[offset + i]
      if (ch === 0 || ch === 0x20) break
      sizeStr += String.fromCharCode(ch)
    }
    const size = parseInt(sizeStr.trim(), 8) || 0

    // typeflag at byte 156
    const typeflag = String.fromCharCode(tarBytes[offset + 156])

    offset += 512 // advance past header

    const isRegularFile = typeflag === '0' || typeflag === '\0' || typeflag === ''

    if (isRegularFile && size > 0) {
      result.set(name, tarBytes.subarray(offset, offset + size))
    }

    // Advance past data blocks (round up to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512
  }

  return result
}

/**
 * Decompress a .tgz / .tar.gz payload and return a flat file map.
 */
function extractTgz(gzBytes: Uint8Array): Map<string, Uint8Array> {
  const tarBytes = decompressSync(gzBytes)
  return untarSync(tarBytes)
}

/**
 * Detect the gomsicDir from a set of extracted files prefixed under a root.
 * Looks for the single subdirectory that contains msinfo32.log or a log/ subdir.
 */
function detectGomsicDir(
  files: Map<string, Uint8Array>,
  rootPrefix: string,
): string | undefined {
  const prefix = rootPrefix.endsWith('/') ? rootPrefix : rootPrefix + '/'
  const subdirs = new Set<string>()

  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const slashIdx = rest.indexOf('/')
    if (slashIdx > 0) {
      subdirs.add(rest.slice(0, slashIdx))
    }
  }

  // Prefer a subdir that contains msinfo32.log or a log/ directory
  for (const sub of subdirs) {
    const candidate = `${prefix}${sub}`
    if (
      files.has(`${candidate}/msinfo32.log`) ||
      hasDir(files, `${candidate}/log`)
    ) {
      return candidate
    }
  }

  // Fall back to the only subdir if there is exactly one
  if (subdirs.size === 1) {
    return `${prefix}${[...subdirs][0]}`
  }

  return undefined
}

// ---- Magic byte detection ----

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b
}

// ---- Main extraction function ----

export function extractArchive(bytes: Uint8Array, filename: string): ArchiveLayout {
  const layout: ArchiveLayout = {
    files: new Map(),
    warnings: [],
  }

  const lowerName = filename.toLowerCase()

  const looksLikeZip = lowerName.endsWith('.zip') || isZip(bytes)
  const looksLikeTgz =
    lowerName.endsWith('.tgz') ||
    lowerName.endsWith('.tar.gz') ||
    (!looksLikeZip && isGzip(bytes))

  if (looksLikeZip) {
    // ---- ZIP branch ----
    let zipEntries: { [path: string]: Uint8Array }
    try {
      zipEntries = unzipSync(bytes)
    } catch (err) {
      layout.warnings.push(`ZIP extraction failed: ${err instanceof Error ? err.message : String(err)}`)
      return layout
    }

    // Populate layout.files
    for (const [path, data] of Object.entries(zipEntries)) {
      layout.files.set(path, data)
    }

    // Detect top-level structure markers
    for (const key of layout.files.keys()) {
      if (key.startsWith('ZQS/') || key === 'ZQS') {
        layout.zqsDir = 'ZQS'
      }
      if (key.startsWith('ZEISS-INSPECT/') || key === 'ZEISS-INSPECT') {
        layout.zeissInspectDir = 'ZEISS-INSPECT'
      }
    }

    // description.txt at archive root
    const descBytes = layout.files.get('description.txt')
    if (descBytes) layout.descriptionTxt = descBytes

    // Extract embedded gomsic.tgz if present
    const gomsicTgzPath = layout.zeissInspectDir
      ? `${layout.zeissInspectDir}/gomsic.tgz`
      : 'ZEISS-INSPECT/gomsic.tgz'

    const tgzBytes = layout.files.get(gomsicTgzPath)
    if (tgzBytes) {
      let innerFiles: Map<string, Uint8Array>
      try {
        innerFiles = extractTgz(tgzBytes)
      } catch (err) {
        layout.warnings.push(
          `gomsic.tgz extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        innerFiles = new Map()
      }

      // Prefix all inner files under gomsic_extracted/
      const innerPrefix = 'gomsic_extracted/'
      for (const [innerPath, data] of innerFiles) {
        layout.files.set(`${innerPrefix}${innerPath}`, data)
      }

      layout.gomsicDir = detectGomsicDir(layout.files, innerPrefix)
    } else {
      // Some archives may have gomsic content directly (no embedded tgz)
      if (hasDir(layout.files, 'gomsic_extracted')) {
        layout.gomsicDir = detectGomsicDir(layout.files, 'gomsic_extracted/')
      }
    }
  } else if (looksLikeTgz) {
    // ---- TGZ branch ----
    let innerFiles: Map<string, Uint8Array>
    try {
      innerFiles = extractTgz(bytes)
    } catch (err) {
      layout.warnings.push(
        `TGZ extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return layout
    }

    const innerPrefix = 'gomsic_extracted/'
    for (const [innerPath, data] of innerFiles) {
      layout.files.set(`${innerPrefix}${innerPath}`, data)
    }

    layout.gomsicDir = detectGomsicDir(layout.files, innerPrefix)
  } else {
    layout.warnings.push(`Unrecognized archive format for file: ${filename}`)
  }

  return layout
}
