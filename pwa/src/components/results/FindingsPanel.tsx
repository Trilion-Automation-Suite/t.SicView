import { useState } from 'react'
import type { ParseResult, Finding, Severity } from '../../worker/models'
import './FindingsPanel.css'

interface Props {
  result: ParseResult
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'WARNING', 'INFO']

const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: 'Critical',
  WARNING: 'Warning',
  INFO: 'Info',
}

const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  CRITICAL: 'badge-critical',
  WARNING: 'badge-warning',
  INFO: 'badge-info',
}

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const groups = new Map<Severity, Finding[]>()
  for (const sev of SEVERITY_ORDER) {
    const items = findings.filter(f => f.severity === sev)
    if (items.length > 0) groups.set(sev, items)
  }
  return groups
}

export function FindingsPanel({ result }: Props) {
  const { findings } = result

  if (findings.length === 0) {
    return (
      <div className="findings-empty card">
        <span className="badge badge-ok">No findings</span>
        <p>No issues were detected in this archive.</p>
      </div>
    )
  }

  const groups = groupBySeverity(findings)

  return (
    <div className="findings-panel">
      {Array.from(groups.entries()).map(([severity, items]) => (
        <section key={severity} className="findings-group">
          <div className="findings-group-header">
            <span className={`badge ${SEVERITY_BADGE_CLASS[severity]}`}>{SEVERITY_LABEL[severity]}</span>
            <span className="findings-group-count">{items.length} finding{items.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="findings-list">
            {items.map((finding, i) => (
              <FindingCard key={i} finding={finding} severity={severity} />
            ))}
          </div>
        </section>
      ))}
      <AiRecapCard result={result} />
    </div>
  )
}

/* ---- AI Ready recap ---- */

function buildAiRecap(result: ParseResult): string {
  const { findings, system_info, zeiss_versions, product_type, detected_product,
          network, licensing, drivers, hardware_service } = result

  const product = detected_product ?? (product_type !== 'Unknown' ? product_type : null)
  const lines: string[] = []

  lines.push('# t.SicView Diagnostic Summary')
  lines.push('')

  // Identity
  lines.push('## System Identity')
  if (system_info?.computer_name) lines.push(`- Computer: ${system_info.computer_name}`)
  if (system_info?.os_name)       lines.push(`- OS: ${system_info.os_name}${system_info.os_version ? ` (${system_info.os_version})` : ''}`)
  if (system_info?.processor)     lines.push(`- CPU: ${system_info.processor}`)
  if (system_info?.total_physical_memory) lines.push(`- RAM: ${system_info.total_physical_memory}`)
  if (product) lines.push(`- Product: ${product}`)
  if (zeiss_versions?.inspect_version)        lines.push(`- ZEISS INSPECT: ${zeiss_versions.inspect_version}`)
  if (zeiss_versions?.hardware_service_version) lines.push(`- Hardware Service: ${zeiss_versions.hardware_service_version}`)
  if (zeiss_versions?.quality_suite_version)  lines.push(`- Quality Suite: ${zeiss_versions.quality_suite_version}`)
  lines.push('')

  // Findings summary
  const critical = findings.filter(f => f.severity === 'CRITICAL')
  const warnings  = findings.filter(f => f.severity === 'WARNING')
  const infos     = findings.filter(f => f.severity === 'INFO')

  lines.push('## Diagnostic Findings')
  lines.push(`Total: ${findings.length} (${critical.length} critical, ${warnings.length} warning, ${infos.length} info)`)
  lines.push('')

  for (const f of [...critical, ...warnings, ...infos]) {
    lines.push(`### [${f.severity}] ${f.title}`)
    lines.push(f.description)
    if (f.recommendation) lines.push(`> Recommendation: ${f.recommendation}`)
    if (f.source_file) lines.push(`> Source: ${f.source_file}`)
    lines.push('')
  }

  // Quick context
  if (network?.adapters && network.adapters.length > 0) {
    lines.push('## Network Adapters')
    for (const a of network.adapters) {
      lines.push(`- ${a.name}${a.ip_addresses.length ? ': ' + a.ip_addresses.join(', ') : ''}`)
    }
    lines.push('')
  }

  if (drivers?.nvidia_driver)   lines.push(`- NVIDIA driver: ${drivers.nvidia_driver}`)
  if (drivers?.mellanox_driver) lines.push(`- Mellanox driver: ${drivers.mellanox_driver}`)
  if (drivers?.rivermax)        lines.push(`- Rivermax: ${drivers.rivermax}`)
  if (drivers?.codemeter)       lines.push(`- CodeMeter: ${drivers.codemeter}`)

  if (licensing?.licensed_products && licensing.licensed_products.length > 0) {
    lines.push('')
    lines.push('## Licensed Products')
    for (const p of licensing.licensed_products) lines.push(`- ${p}`)
  }

  if (hardware_service?.grpc_status) {
    lines.push('')
    lines.push(`## Hardware Service`)
    lines.push(`- gRPC status: ${hardware_service.grpc_status}`)
    if (hardware_service.running != null) lines.push(`- Running: ${hardware_service.running}`)
  }

  if (system_info?.problem_devices.length) {
    lines.push('')
    lines.push('## Problem Devices')
    for (const d of system_info.problem_devices) lines.push(`- ${d}`)
  }

  return lines.join('\n')
}

function AiRecapCard({ result }: { result: ParseResult }) {
  const [copied, setCopied] = useState(false)
  const text = buildAiRecap(result)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section className="ai-recap-card card">
      <div className="ai-recap-header">
        <h3 className="ai-recap-title">AI-Ready Recap</h3>
        <button className="ai-recap-copy-btn" onClick={handleCopy} title="Copy to clipboard">
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      <pre className="ai-recap-text">{text}</pre>
    </section>
  )
}

interface FindingCardProps {
  finding: Finding
  severity: Severity
}

function FindingCard({ finding, severity }: FindingCardProps) {
  return (
    <div className={`finding-card card finding-card--${severity.toLowerCase()}`}>
      <div className="finding-card-header">
        <span className={`badge ${SEVERITY_BADGE_CLASS[severity]}`}>{SEVERITY_LABEL[severity]}</span>
        <h3 className="finding-title">{finding.title}</h3>
      </div>

      <p className="finding-description">{finding.description}</p>

      {finding.recommendation && (
        <div className="finding-recommendation">
          <span className="finding-rec-label">Recommendation</span>
          <p className="finding-rec-text">{finding.recommendation}</p>
        </div>
      )}

      <div className="finding-meta">
        {finding.source_file && (
          <span className="finding-meta-item">
            <span className="finding-meta-key">Source</span>
            <code className="finding-meta-val">{finding.source_file}</code>
          </span>
        )}
        {finding.pattern_id && (
          <span className="finding-meta-item">
            <span className="finding-meta-key">Pattern</span>
            <code className="finding-meta-val">{finding.pattern_id}</code>
          </span>
        )}
      </div>
    </div>
  )
}
