// ============================================================
// parsers/zeiss-versions.ts — Port of Python ZeissVersionsParser
// ============================================================

import { BaseParser, ParserContext } from './base'
import type { ZeissVersions } from '../models'
import {
  zqsInstalledSoftwareDir,
  gomsicLogDir,
} from '../extractor'

export class ZeissVersionsParser extends BaseParser<ZeissVersions> {
  readonly name = 'zeiss_versions'

  parse(ctx: ParserContext): ZeissVersions | null {
    const { layout, gomsicDir } = ctx
    const result: ZeissVersions = { raw_version_data: {} }

    const installedSoftwareDir = zqsInstalledSoftwareDir(layout)

    // 1. Try ZEISS-INSPECT version-index.json
    if (installedSoftwareDir) {
      const inspectFiles = this.findFiles(
        layout,
        installedSoftwareDir,
        'ZEISS-INSPECT/*/version-index.json',
      )
      for (const vpath of inspectFiles) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          const version = this._extractVersion(data)
          if (version) {
            result.inspect_version = version
            result.raw_version_data['inspect_index'] = data
          }
          break
        } catch {
          // continue
        }
      }

      // 2. Try ZEISS-INSPECT-Hardware-Service version-index.json
      const hwFiles = this.findFiles(
        layout,
        installedSoftwareDir,
        'ZEISS-INSPECT-Hardware-Service/*/version-index.json',
      )
      for (const vpath of hwFiles) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          const version = this._extractVersion(data)
          if (version) {
            result.hardware_service_version = version
            result.raw_version_data['hardware_service_index'] = data
          }
          break
        } catch {
          // continue
        }
      }

      // 3. Try ZQS_*.json for quality_suite_version
      const zqsFiles = this.findFiles(layout, installedSoftwareDir, 'ZQS_*.json')
      for (const vpath of zqsFiles) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          // Python reads majorVersion ("7"), but sw.version has the full build ("7.1.2847.0")
          const sw = data['software'] as Record<string, unknown> | undefined
          const version = (
            sw?.['version'] ?? sw?.['fullVersion'] ?? sw?.['majorVersion']
          ) as string | undefined ?? this._extractVersion(data)
          if (version) {
            result.quality_suite_version = String(version)
            result.raw_version_data['zqs_json'] = data
          }
          break
        } catch {
          // continue
        }
      }

      // 4. Try ZEISS-INSPECT_*.json for product_name
      const inspectJsonFiles = this.findFiles(
        layout,
        installedSoftwareDir,
        'ZEISS-INSPECT_*.json',
      )
      for (const vpath of inspectJsonFiles) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          if (typeof data['product_name'] === 'string') {
            result.product_name = data['product_name']
          } else if (typeof data['name'] === 'string') {
            result.product_name = data['name']
          }
          result.raw_version_data['inspect_json'] = data
          break
        } catch {
          // continue
        }
      }
    }

    // 5. Fallback: parse registry.log
    // Python: re.search(r"ZEISS.INSPECT.*?DisplayVersion\s+REG_SZ\s+([\d.]+)", text, re.DOTALL)
    if (!result.inspect_version && gomsicDir) {
      const registryPath = `${gomsicDir}/registry.log`
      const text = this.getText(layout, registryPath)
      if (text) {
        // Use [\s\S]*? to span lines (equivalent to Python re.DOTALL)
        const regMatch = text.match(
          /ZEISS[\s\S]{0,300}?INSPECT[\s\S]{0,500}?DisplayVersion\s+REG_SZ\s+([\d.]+)/i,
        )
        if (regMatch) {
          result.inspect_version = regMatch[1]
          result.raw_version_data['registry_log'] = regMatch[0]
        }
        // Hardware Service version from registry
        if (!result.hardware_service_version) {
          const hwMatch = text.match(
            /Hardware[\s\S]{0,200}?Service[\s\S]{0,500}?DisplayVersion\s+REG_SZ\s+([\d.]+)/i,
          )
          if (hwMatch) {
            result.hardware_service_version = hwMatch[1]
          }
        }
      }
    }

    // 6. Fallback: parse first 3000 chars of ZEISS_INSPECT-*.log
    if ((!result.inspect_version || !result.product_name) && gomsicDir) {
      const logDir = gomsicLogDir(layout)
      if (logDir) {
        const logFiles = this.findFiles(layout, logDir, 'ZEISS_INSPECT-*.log')
        for (const vpath of logFiles) {
          const bytes = layout.files.get(vpath)
          if (!bytes) continue
          const header = this.decodeAuto(bytes.slice(0, 3000))
          if (!result.inspect_version) {
            const verMatch = header.match(/Version:\s+(20\d{2}\.\d+\.\d+\.\d+)/)
            if (verMatch) {
              result.inspect_version = verMatch[1]
              result.raw_version_data['app_log'] = verMatch[0]
            }
          }
          // "Command line: ...ZEISS_INSPECT.exe -license correlate_all"
          if (!result.product_name) {
            const cmdMatch = header.match(/Command line:.*?-license\s+(\S+)/i)
            if (cmdMatch) {
              const licMode = cmdMatch[1].toLowerCase()
              if (licMode.includes('correlate')) {
                result.product_name = 'ZEISS CORRELATE'
              }
            }
          }
          break
        }
      }
    }

    // Only return null if we found nothing useful
    if (
      !result.inspect_version &&
      !result.quality_suite_version &&
      !result.hardware_service_version &&
      !result.product_name
    ) {
      return null
    }

    return result
  }

  private _extractVersion(data: Record<string, unknown>): string | undefined {
    if (typeof data['version'] === 'string') return data['version']
    const index = data['index']
    if (Array.isArray(index) && index.length > 0) {
      const first = index[0] as Record<string, unknown>
      if (typeof first['version'] === 'string') return first['version']
    }
    return undefined
  }
}
