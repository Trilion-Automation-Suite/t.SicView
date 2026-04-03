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

      // KEY=VALUE format, each line → DongleInfo
      for (const line of text.split(/\r?\n/)) {
        const stripped = line.trim()
        if (!stripped || !stripped.includes('=')) continue
        const eqIdx = stripped.indexOf('=')
        const key = stripped.slice(0, eqIdx).trim()
        const value = stripped.slice(eqIdx + 1).trim()
        const dongle: DongleInfo = {}
        const keyLower = key.toLowerCase()
        if (keyLower.includes('type') || keyLower.includes('dongle_type')) {
          dongle.dongle_type = value
        } else if (
          keyLower.includes('serial') ||
          keyLower.includes('id') ||
          keyLower.includes('number')
        ) {
          dongle.serial = value
        } else {
          // Generic: treat key as type
          dongle.dongle_type = key
          dongle.serial = value
        }
        result.dongles.push(dongle)
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

    // 5. App log fallback: parse [license] lines from ZEISS_INSPECT-*.log
    if (gomsicDir && result.licenses.length === 0) {
      const logDir = gomsicLogDir(layout)
      if (logDir) {
        const logFiles = this.findFiles(layout, logDir, 'ZEISS_INSPECT-*.log')
        for (const vpath of logFiles) {
          const text = this.getText(layout, vpath)
          if (!text) continue
          const licenseLineRe = /\[license\]\s+(.+)/gi
          let lm: RegExpExecArray | null
          while ((lm = licenseLineRe.exec(text)) !== null) {
            const line = lm[1].trim()
            // Try to extract a product name from license lines
            const productMatch = line.match(/product[:\s]+([^\s,]+)/i)
            const keyMatch = line.match(/key[:\s]+([^\s,]+)/i)
            const entry: LicenseEntry = {
              raw_fields: { log_line: line },
            }
            if (productMatch) entry.product = productMatch[1]
            if (keyMatch) entry.key = keyMatch[1]
            if (entry.product || entry.key) {
              result.licenses.push(entry)
              foundSomething = true
              if (entry.product && !result.licensed_products.includes(entry.product)) {
                result.licensed_products.push(entry.product)
              }
            }
          }
          if (result.licenses.length > 0) break
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
