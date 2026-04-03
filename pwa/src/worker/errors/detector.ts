// ============================================================
// detector.ts — TypeScript port of gomsic_core/errors/detector.py
// Runs 8 detection passes over a ParseResult and returns Findings.
// ============================================================

import type { KnowledgeBase } from '../kb-loader'
import type {
  Finding,
  ParseResult,
  NetworkInfo,
  NetworkAdapter,
  DriverInfo,
  LicenseInfo,
  LogSummary,
} from '../models'

// ---------------------------------------------------------------------------
// Internal YAML schema types
// ---------------------------------------------------------------------------

interface PatternDef {
  id?: string
  title?: string
  description?: string
  recommendation?: string
  severity?: string
  category?: string
  regex?: string
}

interface NicAdapterRule {
  match?: string[]
  required_for?: string[]
  violation_severity?: string
  recommendation?: string
  expected_properties?: Record<string, string>
}

interface DriverRuleDef {
  required_for?: string[]
  min_version?: string
  recommendation?: string
  description?: string
}

interface LicenseRuleDef {
  required_for?: string[]
  product_patterns?: string[]
  severity?: string
  description?: string
  recommendation?: string
}

// ---------------------------------------------------------------------------
// ErrorDetector
// ---------------------------------------------------------------------------

export class ErrorDetector {
  constructor(private kb: KnowledgeBase) {}

  detect(result: ParseResult): Finding[] {
    const findings: Finding[] = []
    findings.push(...this.runPatternMatching(result))
    if (result.network) findings.push(...this.checkNicConfig(result.network, result.product_type))
    if (result.drivers) findings.push(...this.checkDrivers(result.drivers, result.product_type))
    if (result.licensing) findings.push(...this.checkLicenses(result.licensing, result.product_type))
    if (result.logs) findings.push(...this.analyzeLogEntries(result.logs))
    findings.push(...this.checkHardwareService(result))
    findings.push(...this.checkPrerequisites(result))
    findings.push(...this.checkSystemHealth(result))
    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 1: Pattern Matching
  // -------------------------------------------------------------------------

  private runPatternMatching(result: ParseResult): Finding[] {
    const patterns =
      (this.kb.patterns as { patterns?: PatternDef[] })?.patterns ?? []

    // Collect (source_file, text) pairs from log entries
    const textSources: [string, string][] = []
    for (const entry of result.logs?.entries ?? []) {
      textSources.push([entry.source_file, entry.message])
    }

    const findings: Finding[] = []
    for (const pat of patterns) {
      if (!pat.regex) continue
      try {
        const re = new RegExp(pat.regex, 'i')
        for (const [sourceFile, text] of textSources) {
          if (re.test(text)) {
            findings.push({
              severity: (pat.severity as 'CRITICAL' | 'WARNING' | 'INFO') ?? 'INFO',
              title: pat.title ?? pat.id ?? 'Unknown',
              description: pat.description ?? '',
              recommendation: pat.recommendation,
              pattern_id: pat.id,
              category: pat.category,
              source_file: sourceFile,
              raw_context: [],
            })
            break // one Finding per pattern
          }
        }
      } catch {
        // invalid regex — skip
      }
    }
    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 2: NIC Config Validation
  // -------------------------------------------------------------------------

  private checkNicConfig(
    network: NetworkInfo,
    product: string | undefined,
  ): Finding[] {
    const rules = this.kb.nicRules as Record<string, unknown>
    const adapterRules =
      (rules?.['adapters'] as Record<string, NicAdapterRule>) ?? {}
    const displayNames =
      (rules?.['property_display_names'] as Record<string, string>) ?? {}
    const valueDescs =
      (rules?.['value_descriptions'] as Record<string, Record<string, string>>) ?? {}

    const findings: Finding[] = []

    for (const adapter of network.adapters) {
      for (const [ruleKey, rule] of Object.entries(adapterRules)) {
        // Skip rules not applicable to this product
        if (
          rule.required_for &&
          product &&
          !rule.required_for.includes(product)
        ) {
          continue
        }

        // Match adapter by description/name against rule match[] patterns
        if (!this.adapterMatchesRule(adapter, rule)) continue

        if (!rule.expected_properties) continue

        for (const [prop, expectedValue] of Object.entries(
          rule.expected_properties,
        )) {
          const actualRaw = adapter.advanced_properties?.[prop]
          const actual =
            actualRaw !== undefined && actualRaw !== null
              ? String(actualRaw)
              : undefined

          if (actual === expectedValue) continue

          // Build human-readable names
          const propDisplay = displayNames[prop] ?? prop
          const expectedDisplay =
            valueDescs[prop]?.[expectedValue] ?? expectedValue
          const actualDisplay =
            actual !== undefined
              ? (valueDescs[prop]?.[actual] ?? actual)
              : 'not set'

          findings.push({
            severity:
              (rule.violation_severity as 'CRITICAL' | 'WARNING' | 'INFO') ??
              'WARNING',
            title: `NIC misconfiguration: ${propDisplay} on ${adapter.name}`,
            description:
              `Adapter "${adapter.name}" (rule: ${ruleKey}): ` +
              `${propDisplay} is "${actualDisplay}" but should be "${expectedDisplay}".`,
            recommendation: rule.recommendation,
            category: 'network',
            raw_context: [],
          })
        }
      }
    }
    return findings
  }

  private adapterMatchesRule(
    adapter: NetworkAdapter,
    rule: NicAdapterRule,
  ): boolean {
    if (!rule.match || rule.match.length === 0) return false
    const haystack = [adapter.name, adapter.description ?? '']
      .join(' ')
      .toLowerCase()
    return rule.match.some((m) => haystack.includes(m.toLowerCase()))
  }

  // -------------------------------------------------------------------------
  // Pass 3: Driver Version Checks
  // -------------------------------------------------------------------------

  private checkDrivers(
    drivers: DriverInfo,
    product: string | undefined,
  ): Finding[] {
    const rules = this.kb.driverRules as Record<string, unknown>
    const driverRules =
      (rules?.['drivers'] as Record<string, DriverRuleDef>) ?? {}

    const findings: Finding[] = []

    // Map rule keys to actual version values from DriverInfo
    const versionMap: Record<string, string | null | undefined> = {
      mellanox: drivers.mellanox_driver,
      rivermax: drivers.rivermax,
      codemeter: drivers.codemeter,
      nvidia: drivers.nvidia_driver,
    }

    for (const [driverKey, rule] of Object.entries(driverRules)) {
      if (!rule.required_for || !product) continue
      if (!rule.required_for.includes(product)) continue

      const actualVersion = versionMap[driverKey] ?? null

      if (actualVersion === null || actualVersion === undefined) {
        findings.push({
          severity: 'WARNING',
          title: `Required driver not found: ${driverKey}`,
          description: `The "${driverKey}" driver is required for ${product} but was not found on this system.`,
          recommendation: rule.recommendation,
          category: 'drivers',
          raw_context: [],
        })
      } else if (
        rule.min_version &&
        this.versionLt(actualVersion, rule.min_version)
      ) {
        findings.push({
          severity: 'WARNING',
          title: `Driver version outdated: ${driverKey}`,
          description:
            `The "${driverKey}" driver version is "${actualVersion}" ` +
            `but the minimum required version is "${rule.min_version}".`,
          recommendation: rule.recommendation,
          category: 'drivers',
          raw_context: [],
        })
      }
    }
    return findings
  }

  private versionLt(
    actual: string | undefined | null,
    minimum: string,
  ): boolean {
    if (!actual) return true
    const parse = (v: string) =>
      v
        .split(/[.\-]/)
        .filter((x) => /^\d+$/.test(x))
        .map(Number)
    const a = parse(actual)
    const m = parse(minimum)
    for (let i = 0; i < Math.max(a.length, m.length); i++) {
      const av = a[i] ?? 0
      const mv = m[i] ?? 0
      if (av < mv) return true
      if (av > mv) return false
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Pass 4: License Consistency
  // -------------------------------------------------------------------------

  private checkLicenses(
    licensing: LicenseInfo,
    product: string | undefined,
  ): Finding[] {
    const rules = this.kb.licenseRules as Record<string, unknown>
    const licenseRules =
      (rules?.['licenses'] as Record<string, LicenseRuleDef>) ?? {}

    const findings: Finding[] = []

    for (const [ruleKey, rule] of Object.entries(licenseRules)) {
      if (!rule.required_for || !product) continue
      if (!rule.required_for.includes(product)) continue

      const patterns = rule.product_patterns ?? []
      if (patterns.length === 0) continue

      // Search for a matching license entry
      const found = licensing.licenses.some((lic) => {
        const productStr = (lic.product ?? '').toLowerCase()
        const licName = String(
          lic.raw_fields?.['License Name'] ?? '',
        ).toLowerCase()
        return patterns.some(
          (p) =>
            productStr.includes(p.toLowerCase()) ||
            licName.includes(p.toLowerCase()),
        )
      })

      if (!found) {
        findings.push({
          severity:
            (rule.severity as 'CRITICAL' | 'WARNING' | 'INFO') ?? 'WARNING',
          title: `Missing license: ${ruleKey}`,
          description:
            rule.description ??
            `A required license ("${ruleKey}") for ${product} was not found.`,
          recommendation: rule.recommendation,
          category: 'licensing',
          raw_context: [],
        })
      }
    }
    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 5: Log Entry Analysis
  // -------------------------------------------------------------------------

  private analyzeLogEntries(logs: LogSummary): Finding[] {
    const findings: Finding[] = []
    if (logs.total_errors > 0) {
      findings.push({
        severity: 'INFO',
        title: `${logs.total_errors} error(s) found in log files`,
        description:
          `Found ${logs.total_errors} ERROR-level entries across ` +
          `${logs.files_analyzed.length} log file(s).`,
        category: 'logs',
        raw_context: [],
      })
    }
    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 6: Hardware Service Structural Checks
  // -------------------------------------------------------------------------

  private checkHardwareService(result: ParseResult): Finding[] {
    const hs = result.hardware_service
    if (!hs) return []

    const findings: Finding[] = []

    // 1. Service not running
    if (hs.running === false) {
      findings.push({
        severity: 'CRITICAL',
        title: 'Hardware Service not running',
        description:
          'The ZEISS Hardware Service process was not detected as running on this system.',
        recommendation:
          'Start the Hardware Service via the Windows Services console or by launching ZEISS INSPECT.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 2. HAL gRPC never started
    if (hs.grpc_status == null && hs.running !== false) {
      findings.push({
        severity: 'WARNING',
        title: 'HAL gRPC interface never started',
        description:
          'The Hardware Abstraction Layer gRPC interface has no recorded status, ' +
          'suggesting it may not have initialised correctly.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 3. Empty hardware config
    if (
      hs.timeline.some((e) =>
        e.includes('hardware_cfg.xml is empty'),
      )
    ) {
      findings.push({
        severity: 'WARNING',
        title: 'Hardware configuration is empty',
        description:
          'The hardware_cfg.xml file is empty. No hardware devices will be detected.',
        recommendation:
          'Run the Hardware Service setup wizard or manually configure hardware_cfg.xml.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 4. DB errors
    if (hs.errors.length > 0) {
      findings.push({
        severity: 'CRITICAL',
        title: `${hs.errors.length} hardware error(s) recorded in database`,
        description:
          `The Hardware Service database contains ${hs.errors.length} error record(s), ` +
          `indicating hardware faults or communication issues.`,
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 5. Missing required ports (39000, 39002) — only when ports list is populated and service appears running
    const requiredPorts = [39000, 39002]
    if (hs.ports.length > 0 && hs.running !== false) {
      const openPorts = new Set(hs.ports.map((p) => p.port))
      for (const port of requiredPorts) {
        if (!openPorts.has(port)) {
          findings.push({
            severity: 'WARNING',
            title: `Required port ${port} not open`,
            description:
              `Port ${port} is required by the Hardware Service but was not found in the active port list.`,
            recommendation:
              'Check firewall rules and ensure the Hardware Service is fully initialised.',
            category: 'hardware_service',
            raw_context: [],
          })
        }
      }
    }

    // 6. Multiple instances
    if (hs.multiple_instances) {
      findings.push({
        severity: 'CRITICAL',
        title: 'Multiple Hardware Service instances running',
        description:
          'More than one instance of the Hardware Service was detected. ' +
          'This can cause hardware access conflicts and unpredictable behaviour.',
        recommendation:
          'Terminate all extra Hardware Service processes and restart the service cleanly.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 7. Non-automatic startup type
    if (
      hs.service_startup_type &&
      hs.service_startup_type !== 'Automatic'
    ) {
      findings.push({
        severity: 'WARNING',
        title: `Hardware Service startup type is "${hs.service_startup_type}"`,
        description:
          `The Hardware Service Windows service startup type is set to "${hs.service_startup_type}". ` +
          `It is recommended to set it to "Automatic" so it starts with Windows.`,
        recommendation:
          'Open Services (services.msc), locate the Hardware Service, and set Startup type to Automatic.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    // 8. Restart cycle detected
    if (
      hs.timeline.some((e) =>
        e.toLowerCase().includes('startup events detected'),
      )
    ) {
      findings.push({
        severity: 'WARNING',
        title: 'HAL restart cycle detected',
        description:
          'Multiple Hardware Service startup events were detected in the timeline, ' +
          'indicating the service may be restarting repeatedly.',
        recommendation:
          'Review Hardware Service logs for crash or error messages that trigger restarts.',
        category: 'hardware_service',
        raw_context: [],
      })
    }

    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 7: Prerequisite Checks
  // -------------------------------------------------------------------------

  private checkPrerequisites(result: ParseResult): Finding[] {
    const findings: Finding[] = []
    const drivers = result.drivers
    if (!drivers) return findings

    // Determine major ZEISS INSPECT version
    const major =
      result.zeiss_versions?.inspect_version?.split('.')[0] ?? ''

    const versionRules = (
      this.kb.compatibility as Record<string, unknown>
    )?.['zeiss_inspect_versions'] as Record<string, unknown> | undefined

    const majorRules = (
      versionRules?.[major] as Record<string, unknown> | undefined
    )

    const components = (
      majorRules?.['components'] as Record<
        string,
        { min_version?: string; name?: string }
      >
    ) ?? {}

    // Helper: search for a display name across install_timeline and all_relevant_drivers
    const findDriver = (nameFragment: string) => {
      const allDrivers = [
        ...drivers.install_timeline,
        ...drivers.all_relevant_drivers,
      ]
      return allDrivers.find((d) =>
        (d.name ?? '').toLowerCase().includes(nameFragment.toLowerCase()),
      )
    }

    // .NET Runtime
    const dotnetRule = components['dotnet'] ?? components['dotnet_runtime']
    if (dotnetRule) {
      const dotnetDriver = findDriver('.NET Runtime')
      if (!dotnetDriver) {
        findings.push({
          severity: 'CRITICAL',
          title: '.NET Runtime not found',
          description:
            '.NET Runtime is required by ZEISS INSPECT but was not found in the installed software list.',
          recommendation: `Install .NET Runtime ${dotnetRule.min_version ?? ''} or later from https://dotnet.microsoft.com/`,
          category: 'prerequisites',
          raw_context: [],
        })
      } else if (
        dotnetRule.min_version &&
        this.versionLt(dotnetDriver.version, dotnetRule.min_version)
      ) {
        findings.push({
          severity: 'WARNING',
          title: '.NET Runtime version is outdated',
          description:
            `Detected .NET Runtime version "${dotnetDriver.version ?? 'unknown'}" ` +
            `but the minimum required version is "${dotnetRule.min_version}".`,
          recommendation: `Update .NET Runtime to version ${dotnetRule.min_version} or later.`,
          category: 'prerequisites',
          raw_context: [],
        })
      }
    }

    // Visual C++ Redistributable 2015-2022 x64
    const vcredistDriver = findDriver(
      'Visual C++ 2015-2022 Redistributable (x64)',
    )
    if (!vcredistDriver) {
      findings.push({
        severity: 'WARNING',
        title: 'Visual C++ 2015-2022 Redistributable (x64) not found',
        description:
          'Visual C++ 2015-2022 Redistributable (x64) is required by ZEISS INSPECT ' +
          'but was not found in the installed software list.',
        recommendation:
          'Install the Visual C++ 2015-2022 Redistributable (x64) from the Microsoft website.',
        category: 'prerequisites',
        raw_context: [],
      })
    }

    return findings
  }

  // -------------------------------------------------------------------------
  // Pass 8: System Health
  // -------------------------------------------------------------------------

  private checkSystemHealth(result: ParseResult): Finding[] {
    const findings: Finding[] = []

    // 1. Problem devices
    for (const device of result.system_info?.problem_devices ?? []) {
      findings.push({
        severity: 'WARNING',
        title: `Problem device detected: ${device}`,
        description: `Windows Device Manager reports a problem with device: "${device}".`,
        recommendation:
          'Update or reinstall the device driver, or check device connectivity.',
        category: 'system',
        raw_context: [],
      })
    }

    // 2. Disconnected NICs
    for (const adapter of result.network?.adapters ?? []) {
      const connState = adapter.advanced_properties?.['_ConnectionState']
      if (
        connState !== undefined &&
        ['disconnected', 'not present'].includes(
          String(connState).toLowerCase(),
        )
      ) {
        findings.push({
          severity: 'WARNING',
          title: `Network adapter disconnected: ${adapter.name}`,
          description: `Network adapter "${adapter.name}" has connection state: "${connState}".`,
          recommendation:
            'Check the cable connection or re-enable the network adapter.',
          category: 'network',
          raw_context: [],
        })
      }
    }

    // 3. Low disk space on C:
    for (const drive of result.codemeter?.drives ?? []) {
      if (
        drive.letter.startsWith('C') &&
        drive.free_mb !== undefined &&
        drive.free_mb < 5120
      ) {
        findings.push({
          severity: 'WARNING',
          title: `Low disk space on ${drive.letter}`,
          description:
            `Drive ${drive.letter} has only ${drive.free_mb} MB free. ` +
            `ZEISS INSPECT requires adequate disk space for project files and temporary data.`,
          recommendation:
            'Free up disk space on the system drive to ensure stable operation.',
          category: 'system',
          raw_context: [],
        })
      }
    }

    // 4. Rivermax environment variable missing for ARAMIS 24M
    if (result.product_type === 'ARAMIS 24M') {
      const rivermaxEnvVars =
        result.hardware_service?.rivermax_env_vars ?? {}
      const systemEnvVars = result.system_info?.environment_variables ?? {}

      const hasRivermaxLogLevel =
        'RIVERMAX_LOG_LEVEL' in rivermaxEnvVars ||
        'RIVERMAX_LOG_LEVEL' in systemEnvVars

      if (!hasRivermaxLogLevel) {
        findings.push({
          severity: 'WARNING',
          title: 'RIVERMAX_LOG_LEVEL environment variable not set',
          description:
            'The RIVERMAX_LOG_LEVEL environment variable is required for ARAMIS 24M ' +
            'Rivermax network streaming but was not found in the system or Hardware Service environment.',
          recommendation:
            'Set RIVERMAX_LOG_LEVEL as a system environment variable (e.g., value: 0) ' +
            'and restart the Hardware Service.',
          category: 'network',
          raw_context: [],
        })
      }
    }

    return findings
  }
}
