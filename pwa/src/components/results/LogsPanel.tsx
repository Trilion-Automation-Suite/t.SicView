import { useState } from 'react'
import type { ParseResult, LogFileEntry } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

export function LogsPanel({ result }: Props) {
  const { logs, log_inventory } = result

  const hasLogs = logs != null
  const hasInventory = log_inventory != null && log_inventory.files.length > 0

  if (!hasLogs && !hasInventory) {
    return (
      <div className="card panel-placeholder">No log data available.</div>
    )
  }

  return (
    <div className="panel-stack">
      {/* Summary */}
      {logs && (
        <section className="card">
          <h2 className="panel-heading">Summary</h2>
          <div className="stat-summary">
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

      {/* Log file inventory */}
      {hasInventory && (
        <section className="card">
          <h2 className="panel-heading">Log Files ({log_inventory!.files.length})</h2>
          <div className="log-file-list">
            {log_inventory!.files.map((file, i) => (
              <LogFileCard key={i} file={file} />
            ))}
          </div>
        </section>
      )}

    </div>
  )
}

/* ---- Log File Card ---- */
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
          {file.description && (
            <span className="log-file-desc">{file.description}</span>
          )}
        </div>
        <div className="log-file-badges">
          {file.has_errors && <span className="badge badge-critical">Errors</span>}
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
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {file.path}
            </span>
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
