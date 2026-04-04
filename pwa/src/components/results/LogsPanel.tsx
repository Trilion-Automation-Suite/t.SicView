import { useState } from 'react'
import type { ParseResult, LogFileEntry } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

// ---- Grouping ----

interface LogGroup {
  label: string
  description: string
  files: LogFileEntry[]
}

function classifyFile(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.startsWith('zi_acq'))         return 'zi_acq'
  if (lower.startsWith('gom-hal'))        return 'gom-hal'
  if (lower.startsWith('gom-acq'))        return 'gom-acq'
  if (lower.startsWith('zeiss_inspect'))  return 'zeiss_inspect'
  if (lower.startsWith('gomsoftware') || lower.startsWith('gom-software')) return 'gomsoftware'
  if (lower.startsWith('gom-'))           return 'gom-other'
  return 'other'
}

const GROUP_META: Record<string, { label: string; description: string }> = {
  zeiss_inspect: { label: 'ZEISS INSPECT',             description: 'Main application logs' },
  zi_acq:        { label: 'Acquisition (zi_acq)',       description: 'ZEISS 2026 acquisition session logs' },
  'gom-hal':     { label: 'Hardware Abstraction Layer', description: 'HAL / hardware driver logs' },
  'gom-acq':     { label: 'GOM Acquisition',            description: 'GOM acquisition controller logs' },
  gomsoftware:   { label: 'GOM Software',               description: 'GOM software platform logs' },
  'gom-other':   { label: 'GOM (other)',                description: 'Other GOM subsystem logs' },
  other:         { label: 'Other',                      description: 'Uncategorised log files' },
}

const GROUP_ORDER = ['zeiss_inspect', 'zi_acq', 'gom-hal', 'gom-acq', 'gomsoftware', 'gom-other', 'other']

function buildGroups(files: LogFileEntry[]): LogGroup[] {
  const buckets: Record<string, LogFileEntry[]> = {}
  for (const file of files) {
    const key = classifyFile(file.filename)
    ;(buckets[key] ??= []).push(file)
  }
  return GROUP_ORDER
    .filter((k) => buckets[k]?.length)
    .map((k) => ({
      label: GROUP_META[k].label,
      description: GROUP_META[k].description,
      files: buckets[k],
    }))
}

// ---- Component ----

export function LogsPanel({ result }: Props) {
  const { logs, log_inventory } = result

  const hasLogs     = logs != null
  const hasInventory = log_inventory != null && log_inventory.files.length > 0

  if (!hasLogs && !hasInventory) {
    return <div className="card panel-placeholder">No log data available.</div>
  }

  const groups = hasInventory ? buildGroups(log_inventory!.files) : []
  const [openStates, setOpenStates] = useState<boolean[]>(() => groups.map(() => false))

  const allOpen  = openStates.length > 0 && openStates.every(Boolean)
  const allClose = openStates.every((v) => !v)

  const toggleGroup = (i: number) =>
    setOpenStates((prev) => prev.map((v, j) => (j === i ? !v : v)))

  const expandAll  = () => setOpenStates(groups.map(() => true))
  const collapseAll = () => setOpenStates(groups.map(() => false))

  return (
    <div className="panel-stack">
      {/* Summary + controls */}
      {logs && (
        <section className="card">
          <div className="log-panel-header">
            <h2 className="panel-heading" style={{ margin: 0 }}>Summary</h2>
            {groups.length > 1 && (
              <div className="log-expand-controls">
                <button className="btn-log-ctrl" onClick={expandAll}  disabled={allOpen}>Expand all</button>
                <button className="btn-log-ctrl" onClick={collapseAll} disabled={allClose}>Collapse all</button>
              </div>
            )}
          </div>
          <div className="stat-summary" style={{ marginTop: 12 }}>
            <div className="stat-item">
              <span className="stat-label">Total Errors</span>
              <span className={`stat-value${logs.total_errors > 0 ? ' stat-value--critical' : ''}`}>
                {logs.total_errors}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Warnings</span>
              <span className={`stat-value${logs.total_warnings > 0 ? ' stat-value--warning' : ''}`}>
                {logs.total_warnings}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Files Analyzed</span>
              <span className="stat-value">{logs.files_analyzed.length}</span>
            </div>
          </div>
        </section>
      )}

      {/* Grouped log files */}
      {groups.map((group, i) => (
        <LogGroupSection
          key={group.label}
          group={group}
          open={openStates[i] ?? false}
          onToggle={() => toggleGroup(i)}
        />
      ))}
    </div>
  )
}

// ---- Log Group Section ----

function LogGroupSection({
  group,
  open,
  onToggle,
}: {
  group: LogGroup
  open: boolean
  onToggle: () => void
}) {
  const errorCount = group.files.filter((f) => f.has_errors).length
  const warnCount  = group.files.filter((f) => f.has_warnings).length

  return (
    <section className="card log-group">
      <button className="log-group-header" onClick={onToggle}>
        <span className="log-group-chevron" aria-hidden>{open ? '▼' : '▶'}</span>
        <span className="log-group-label">{group.label}</span>
        <span className="log-group-count">{group.files.length} file{group.files.length !== 1 ? 's' : ''}</span>
        {errorCount > 0 && <span className="badge badge-critical">{errorCount} w/ errors</span>}
        {warnCount  > 0 && <span className="badge badge-warning">{warnCount} w/ warnings</span>}
        <span className="log-group-desc">{group.description}</span>
      </button>

      {open && (
        <div className="log-file-list">
          {group.files.map((file, j) => (
            <LogFileCard key={j} file={file} />
          ))}
        </div>
      )}
    </section>
  )
}

// ---- Log File Card ----

function LogFileCard({ file }: { file: LogFileEntry }) {
  const [open, setOpen] = useState(false)
  const sizeKb = (file.size_bytes / 1024).toFixed(1)

  return (
    <div className="log-file-card">
      <div className="log-file-row">
        <div className="log-file-info">
          <span className="log-file-name">{file.filename}</span>
          <span className="log-file-stats">
            {file.line_count.toLocaleString()} lines · {sizeKb} KB
            {file.first_timestamp && ` · ${file.first_timestamp}`}
          </span>
        </div>
        <div className="log-file-badges">
          {file.has_errors   && <span className="badge badge-critical">Errors</span>}
          {file.has_warnings && <span className="badge badge-warning">Warnings</span>}
          {file.content && (
            <button className="btn-open-log" onClick={() => setOpen((v) => !v)}>
              {open ? 'Close' : 'Open'}
            </button>
          )}
        </div>
      </div>

      {open && file.content && (
        <div className="log-file-viewer">
          <div className="log-file-viewer-toolbar">
            <span className="log-file-viewer-path">{file.path}</span>
            <button
              className="btn-copy-log"
              onClick={() => navigator.clipboard.writeText(file.content!)}
            >
              Copy
            </button>
          </div>
          <pre className="log-content">
            {file.content.slice(0, 100_000)}
            {file.content.length > 100_000 && '\n\n[... truncated — first 100 000 chars shown ...]'}
          </pre>
        </div>
      )}
    </div>
  )
}
