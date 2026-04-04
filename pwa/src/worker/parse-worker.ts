// ============================================================
// parse-worker.ts — Web Worker entry point
// Handles 'parse' messages, orchestrates extraction + KB loading.
// ============================================================

import { extractArchive } from './extractor'
import { loadKnowledgeBase } from './kb-loader'
import type { ParseResult, ProductType, LogInventory } from './models'
import { SystemInfoParser } from './parsers/system-info'
import { ZeissVersionsParser } from './parsers/zeiss-versions'
import { NetworkParser } from './parsers/network'
import { LicensingParser } from './parsers/licensing'
import { USBParser } from './parsers/usb'
import { GomSoftwareCfgParser } from './parsers/gomsoftware-cfg'
import { WindowsUpdateParser } from './parsers/windows-update'
import { DriversParser } from './parsers/drivers'
import { HardwareServiceParser } from './parsers/hardware-service'
import { LogsParser } from './parsers/logs'
import { CamerasParser } from './parsers/cameras'
import { CodeMeterParser } from './parsers/codemeter'
import { QualitySuiteLogParser } from './parsers/quality-suite-log'
import { ActivityTimelineParser } from './parsers/activity-timeline'
import { ErrorDetector } from './errors/detector'

// ---- Message protocol types ----

type InMsg = {
  type: 'parse'
  id: string
  fileBytes: Uint8Array
  filename: string
  product: string
  description: string | null
}

type OutMsg =
  | { type: 'ready' }
  | { type: 'progress'; id: string; stage: string; message: string }
  | { type: 'result'; id: string; result: string }
  | { type: 'error'; id: string; message: string }

// ---- Helpers ----

function post(msg: OutMsg): void {
  self.postMessage(msg)
}

function progress(id: string, stage: string, message: string): void {
  post({ type: 'progress', id, stage, message })
}

// ---- Parser instances (created once) ----

const parsers = {
  zeissVersions: new ZeissVersionsParser(),
  systemInfo: new SystemInfoParser(),
  licensing: new LicensingParser(),
  network: new NetworkParser(),
  drivers: new DriversParser(),
  cameras: new CamerasParser(),
  usb: new USBParser(),
  hardwareService: new HardwareServiceParser(),
  logs: new LogsParser(),
  codemeter: new CodeMeterParser(),
  gomsoftwareCfg: new GomSoftwareCfgParser(),
  qualitySuiteLog: new QualitySuiteLogParser(),
  windowsUpdates: new WindowsUpdateParser(),
  activityTimeline: new ActivityTimelineParser(),
}

// ---- Message handler ----

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type !== 'parse') return

  const { id, fileBytes, filename, product, description } = msg

  try {
    // Step 1: Extract archive
    progress(id, 'Extracting', `Extracting ${filename}...`)
    const layout = extractArchive(fileBytes, filename)
    for (const w of layout.warnings) {
      progress(id, 'Extracting', `Warning: ${w}`)
    }

    // Step 2: Load knowledge base
    progress(id, 'Loading knowledge base', 'Fetching YAML knowledge base...')
    const kb = await loadKnowledgeBase()
    progress(id, 'Loading knowledge base', 'Done.')

    // Step 3: Read description.txt from archive if no user-supplied description
    let issueDescription: string | null = description
    if (!issueDescription && layout.descriptionTxt) {
      issueDescription = new TextDecoder().decode(layout.descriptionTxt).trim() || null
    }

    // Build shared ParserContext factory
    const makeCtx = () => ({
      layout,
      trace: {
        parser_name: '',
        status: 'success' as const,
        duration_ms: 0,
        files_searched: 0,
        files_found: 0,
        files_parsed: 0,
      },
      gomsicDir: layout.gomsicDir,
    })

    // Step 4: Run parsers
    progress(id, 'Parsing', 'Parsing ZEISS version info...')
    const zeissVersions = parsers.zeissVersions.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing system info...')
    const systemInfo = parsers.systemInfo.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing network configuration...')
    const network = parsers.network.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing licensing...')
    const licensing = parsers.licensing.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing drivers...')
    const drivers = parsers.drivers.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing cameras...')
    const cameras = parsers.cameras.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing USB...')
    const usb = parsers.usb.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing hardware service...')
    let hardwareService = undefined
    try {
      const hsResult = await parsers.hardwareService.parseAsync(makeCtx())
      hardwareService = hsResult ?? undefined
    } catch (hsErr) {
      progress(id, 'Parsing', `Hardware service parse warning: ${hsErr}`)
    }

    progress(id, 'Parsing', 'Parsing log files...')
    const logs = parsers.logs.parse(makeCtx()) ?? undefined
    const logInventory = (parsers.logs.logInventory ?? undefined) as LogInventory | undefined

    progress(id, 'Parsing', 'Parsing CodeMeter...')
    const codemeter = parsers.codemeter.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing software config...')
    const gomsoftwareConfig = parsers.gomsoftwareCfg.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing Quality Suite log...')
    const qualitySuiteLog = parsers.qualitySuiteLog.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing Windows updates...')
    const windowsUpdates = parsers.windowsUpdates.parse(makeCtx()) ?? undefined

    progress(id, 'Parsing', 'Parsing activity timeline...')
    const activityTimeline = parsers.activityTimeline.parse(makeCtx()) ?? undefined

    // Step 5: Auto-detect product type if not provided or Unknown
    let detectedProduct: ProductType | undefined = undefined
    if (!product || product === 'Unknown') {
      detectedProduct = detectProduct(licensing, cameras)
    }

    // Step 6: Build result and run error detection
    progress(id, 'Analyzing', 'Running diagnostic checks...')

    const result: ParseResult = {
      archive_filename: filename,
      parsed_at: new Date().toISOString(),
      tool_version: '0.4.1',
      product_type: (product as ProductType) || 'Unknown',
      detected_product: detectedProduct,
      user_description: description ?? undefined,
      user_issue_description: issueDescription ?? undefined,
      zeiss_versions: zeissVersions,
      system_info: systemInfo,
      network,
      licensing,
      drivers,
      cameras,
      usb,
      hardware_service: hardwareService,
      logs,
      codemeter,
      gomsoftware_config: gomsoftwareConfig,
      quality_suite_log: qualitySuiteLog,
      windows_updates: windowsUpdates,
      activity_timeline: activityTimeline,
      log_inventory: logInventory,
      findings: [],
      verified_checks: [],
    }

    try {
      const detector = new ErrorDetector(kb)
      result.findings = detector.detect(result)
      progress(id, 'Analyzing', `Found ${result.findings.length} diagnostic findings.`)
    } catch (detErr) {
      progress(id, 'Analyzing', `Detection warning: ${detErr}`)
    }

    progress(id, 'Done', 'Parse complete.')
    post({ type: 'result', id, result: JSON.stringify(result) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', id, message })
  }
}

// ---- Product auto-detection ----

function detectProduct(
  licensing: ReturnType<LicensingParser['parse']> | undefined,
  cameras: ReturnType<CamerasParser['parse']> | undefined,
): ProductType | undefined {
  const PRODUCT_PATTERNS: [RegExp, ProductType][] = [
    [/aramis.?24\s*m/i, 'ARAMIS 24M'],
    [/aramis.?12\s*m/i, 'ARAMIS 12M'],
    [/aramis.?4\s*m/i, 'ARAMIS 4M'],
    [/aramis.?srx/i, 'ARAMIS SRX'],
    [/atos.?q.?awk/i, 'ATOS Q AWK'],
    [/atos.?q(?!\s*awk)/i, 'ATOS Q'],
    [/gom.?scan.?ports/i, 'GOM Scan Ports'],
    [/gom.?scan.?1/i, 'GOM Scan 1'],
    [/t.?scan/i, 'T-SCAN'],
    [/argus/i, 'ARGUS'],
  ]

  const matchIn = (text: string): ProductType | undefined => {
    for (const [re, pt] of PRODUCT_PATTERNS) {
      if (re.test(text)) return pt
    }
    return undefined
  }

  // Check license product names
  if (licensing?.licenses) {
    for (const lic of licensing.licenses) {
      const text = [lic.product, String(lic.raw_fields?.['License Name'] ?? '')].filter(Boolean).join(' ')
      const match = matchIn(text)
      if (match) return match
    }
  }

  // Check camera sensor types
  if (cameras?.controllers) {
    for (const c of cameras.controllers) {
      if (c.sensor_type) {
        const match = matchIn(c.sensor_type)
        if (match) return match
      }
    }
  }

  return undefined
}

// Signal readiness to the main thread
post({ type: 'ready' })
