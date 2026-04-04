// ============================================================
// parsers/licensing.ts — Port of Python LicensingParser
// ============================================================

import Papa from 'papaparse'
import { BaseParser, ParserContext } from './base'
import type { LicenseInfo, LicenseEntry, DongleInfo } from '../models'
import {
  zqsLicenseDir,
  zqsInstalledSoftwareDir,
  gomsicLogDir,
} from '../extractor'

export class LicensingParser extends BaseParser<LicenseInfo> {
  readonly name = 'licensing'

  parse(ctx: ParserContext): LicenseInfo | null {
    const { layout, gomsicDir } = ctx
    const result: LicenseInfo = {
      licenses: [],
      dongles: [],
      licensed_products: [],
      license_manifest: {},
    }

    let foundSomething = false

    const licenseDir = zqsLicenseDir(layout)
    const installedSoftwareDir = zqsInstalledSoftwareDir(layout)

    // --- Helper: try to load licenses.csv from a directory ---
    const tryLicensesCsv = (dir: string): boolean => {
      const vpath = `${dir}/licenses.csv`
      const text = this.getText(layout, vpath)
      if (!text) return false

      try {
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          delimiter: ';',
          skipEmptyLines: true,
        })

        for (const row of parsed.data) {
          const entry: LicenseEntry = { raw_fields: { ...row } }

          // Map common CSV column names
          const productCol =
            row['Product'] ?? row['License Name'] ?? row['product'] ?? ''
          const keyCol =
            row['Key'] ?? row['License Key'] ?? row['key'] ?? ''
          const expiryCol =
            row['Expiry'] ?? row['Expiration'] ?? row['expiry'] ?? ''
          const typeCol =
            row['License Type'] ?? row['Type'] ?? row['type'] ?? ''
          const versionCol =
            row['Version'] ?? row['version'] ?? ''

          if (productCol) entry.product = productCol
          if (keyCol) entry.key = keyCol
          if (expiryCol) entry.expiry = expiryCol
          if (typeCol) entry.license_type = typeCol
          if (versionCol) entry.version = versionCol

          result.licenses.push(entry)

          // Build licensed_products from "License Name" column
          const licenseName =
            row['License Name'] ?? row['Product'] ?? row['product'] ?? ''
          if (
            licenseName &&
            !result.licensed_products.includes(licenseName)
          ) {
            result.licensed_products.push(licenseName)
          }
        }
        return true
      } catch {
        return false
      }
    }

    // --- Helper: try to load dongles.csv from a directory ---
    const tryDonglesCsv = (dir: string): boolean => {
      const vpath = `${dir}/dongles.csv`
      const text = this.getText(layout, vpath)
      if (!text) return false

      // KEY=VALUE format: "WIBU=3-7335918" → { dongle_type: 'WIBU', serial: '3-7335918' }
      for (const line of text.split(/\r?\n/)) {
        const stripped = line.trim()
        if (!stripped || !stripped.includes('=')) continue
        const eqIdx = stripped.indexOf('=')
        const dtype = stripped.slice(0, eqIdx).trim()
        const serial = stripped.slice(eqIdx + 1).trim()
        result.dongles.push({ dongle_type: dtype, serial })
      }
      return result.dongles.length > 0
    }

    // 1. Priority: ZQS License directory
    if (licenseDir) {
      if (tryLicensesCsv(licenseDir)) foundSomething = true
      if (tryDonglesCsv(licenseDir)) foundSomething = true
    }

    // 2. Gomsic-level fallback
    if (gomsicDir) {
      if (!foundSomething || result.licenses.length === 0) {
        if (tryLicensesCsv(gomsicDir)) foundSomething = true
      }
      if (!foundSomething || result.dongles.length === 0) {
        if (tryDonglesCsv(gomsicDir)) foundSomething = true
      }
    }

    // 3. ZEISS-INSPECT_*.json license manifest
    if (installedSoftwareDir) {
      const manifestFiles = this.findFiles(
        layout,
        installedSoftwareDir,
        'ZEISS-INSPECT_*.json',
      )
      for (const vpath of manifestFiles) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          if (data['licenses'] || data['products'] || data['license']) {
            result.license_manifest = data
            foundSomething = true
            break
          }
        } catch {
          // continue
        }
      }
    }

    // 4. Fallback: license_info.log
    if (gomsicDir && result.licenses.length === 0) {
      const licenseLogPath = `${gomsicDir}/license_info.log`
      const text = this.getText(layout, licenseLogPath)
      if (text) {
        foundSomething = true
        // Parse "found dongle '...'" lines
        const dongleRe = /found dongle\s+'([^']+)'/gi
        let dm: RegExpExecArray | null
        while ((dm = dongleRe.exec(text)) !== null) {
          result.dongles.push({ dongle_type: dm[1] })
        }

        // Parse package lines: "HH:MM:SS     Product Name (qty, expiry)"
        const packageRe =
          /\d{2}:\d{2}:\d{2}\s{2,}(.+?)\s+\((\d+),\s*([^)]+)\)/g
        let pm: RegExpExecArray | null
        while ((pm = packageRe.exec(text)) !== null) {
          const productName = pm[1].trim()
          const expiry = pm[3].trim()
          const entry: LicenseEntry = {
            product: productName,
            expiry,
            raw_fields: { qty: pm[2] },
          }
          result.licenses.push(entry)
          if (!result.licensed_products.includes(productName)) {
            result.licensed_products.push(productName)
          }
        }
      }
    }

    // 5. App log fallback: parse [license] lines from ZEISS_INSPECT-*.log,
    //    gomsoftware-current.log, gomsoftware*.log (mirrors Python _parse_app_log_licenses)
    if (result.licenses.length === 0 && result.dongles.length === 0) {
      const logDir = gomsicLogDir(layout)
      if (logDir) {
        const seen = new Set<string>()
        const candidates: string[] = []
        for (const pat of ['ZEISS_INSPECT-*.log', 'gomsoftware-current.log', 'gomsoftware*.log']) {
          for (const vpath of this.findFiles(layout, logDir, pat)) {
            if (!seen.has(vpath)) { seen.add(vpath); candidates.push(vpath) }
          }
        }

        for (const vpath of candidates) {
          const text = this.getText(layout, vpath)
          if (!text) continue

          // [license] Dongles changed event: [WIBU=3-7335918]
          const dongleMatch = text.match(/\[license\] Dongles changed event: \[(\w+)=([^\]]+)\]/)
          if (dongleMatch && result.dongles.length === 0) {
            result.dongles.push({ dongle_type: dongleMatch[1], serial: dongleMatch[2] })
            foundSomething = true
          }

          // [license] Successfully consumed Z_INSPECT_correlate (2026) from no-net.
          const consumedRe = /\[license\] Successfully consumed (\S+) \((\d+)\) from (\S+)/g
          let cm: RegExpExecArray | null
          while ((cm = consumedRe.exec(text)) !== null) {
            const feat = cm[1], year = cm[2], server = cm[3]
            const name = feat.replace(/^Z_INSPECT_/, '').replace(/_/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase())
            const entry: LicenseEntry = {
              product: `ZEISS INSPECT ${name}`,
              version: year,
              license_type: `Thales RMS (${server})`,
              raw_fields: { feature: feat, server },
            }
            result.licenses.push(entry)
            foundSomething = true
            if (!result.licensed_products.includes(name)) result.licensed_products.push(name)
          }

          // [license] On demand licenses (2): sensor-aramis,sensor-aramis-24m
          const onDemandMatch = text.match(/\[license\] On demand licenses \(\d+\): (.+)/)
          if (onDemandMatch) {
            for (const feat of onDemandMatch[1].split(',')) {
              const name = feat.trim().replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
              const label = `${name} (on demand)`
              if (!result.licensed_products.includes(label)) result.licensed_products.push(label)
            }
            foundSomething = true
          }

          if (result.licenses.length > 0 || result.dongles.length > 0) break
        }
      }
    }

    // 6. Last resort: scan all *.log files in gomsicDir for dongle/license patterns
    if (!foundSomething && result.licenses.length === 0 && result.dongles.length === 0 && gomsicDir) {
      const allLogs = this.findFiles(layout, gomsicDir, '*.log')
      for (const vpath of allLogs) {
        const text = this.getText(layout, vpath)
        if (!text) continue
        if (/found dongle|license.*package|consuming license/i.test(text)) {
          // Re-use license_info.log parsing logic
          const dongleM = text.match(/found dongle '([^']+)'/)
          if (dongleM && result.dongles.length === 0) {
            result.dongles.push({ dongle_type: 'WIBU', serial: dongleM[1] })
            foundSomething = true
          }
          const packageRe = /^\d{2}:\d{2}:\d{2}\s{4,}(.+?)\s+\((\d+),\s*([^)]+)\)/gm
          let pm: RegExpExecArray | null
          while ((pm = packageRe.exec(text)) !== null) {
            const productName = pm[1].trim()
            const expiry = pm[3].trim()
            const entry: LicenseEntry = {
              product: productName,
              expiry: expiry === 'never expires' ? 'Permanent' : expiry,
              license_type: 'CodeMeter',
              raw_fields: { quantity: pm[2] },
            }
            result.licenses.push(entry)
            foundSomething = true
            if (!result.licensed_products.includes(productName)) result.licensed_products.push(productName)
          }
          if (foundSomething) break
        }
      }
    }

    if (
      !foundSomething &&
      result.licenses.length === 0 &&
      result.dongles.length === 0 &&
      Object.keys(result.license_manifest).length === 0
    ) {
      return null
    }

    return result
  }
}
