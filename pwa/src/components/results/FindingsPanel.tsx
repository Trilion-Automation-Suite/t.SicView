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
    </div>
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
