import type { ParseResult, LogEntry, LogFileEntry } from '../../worker/models'
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

      {/* Log entries */}
      {logs && logs.entries.length > 0 && (
        <LogEntriesCard entries={logs.entries} />
      )}
    </div>
  )
}

/* ---- Log File Card ---- */
function LogFileCard({ file }: { file: LogFileEntry }) {
  const sizeKb = (file.size_bytes / 1024).toFixed(1)

  return (
    <details className="panel-details">
      <summary>
        <div className="log-file-header">
          <span className="log-file-name">{file.filename}</span>
          {file.has_errors && <span className="badge badge-critical">Errors</span>}
          {file.has_warnings && <span className="badge badge-warning">Warnings</span>}
        </div>
      </summary>
      <div className="details-body">
        {file.description && (
          <p className="log-file-desc" style={{ marginBottom: 8 }}>{file.description}</p>
        )}
        <div className="log-file-meta">
          <span>{file.line_count.toLocaleString()} lines</span>
          <span>{sizeKb} KB</span>
          {file.first_timestamp && <span>First: {file.first_timestamp}</span>}
          {file.last_timestamp && <span>Last: {file.last_timestamp}</span>}
        </div>
        {file.content && (
          <pre className="log-content" style={{ marginTop: 8 }}>
            {file.content.slice(0, 8000)}
            {file.content.length > 8000 && '\n\n[... truncated ...]'}
          </pre>
        )}
      </div>
    </details>
  )
}

/* ---- Log Entries ---- */
function LogEntriesCard({ entries }: { entries: LogEntry[] }) {
  const visible = entries.slice(0, 100)

  return (
    <section className="card">
      <h2 className="panel-heading">
        Log Entries (showing {visible.length} of {entries.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map((entry, i) => (
          <LogEntryRow key={i} entry={entry} />
        ))}
      </div>
    </section>
  )
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const level = (entry.level ?? '').toLowerCase()
  const cardClass =
    level === 'error' || level === 'critical'
      ? 'log-entry log-entry--error'
      : level === 'warning' || level === 'warn'
      ? 'log-entry log-entry--warning'
      : 'log-entry log-entry--info'

  const badgeClass =
    level === 'error' || level === 'critical'
      ? 'badge badge-critical'
      : level === 'warning' || level === 'warn'
      ? 'badge badge-warning'
      : 'badge badge-info'

  const contextLines = [
    ...(entry.context_before ?? []),
    ...(entry.context_after ?? []),
  ]

  return (
    <div className={cardClass}>
      <div className="log-entry-header">
        {entry.level && <span className={badgeClass}>{entry.level}</span>}
        <span className="log-entry-source">{entry.source_file}</span>
        {entry.line_number != null && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>:{entry.line_number}</span>
        )}
        {entry.timestamp && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {entry.timestamp}
          </span>
        )}
      </div>
      <div className="log-entry-message">{entry.message}</div>
      {contextLines.length > 0 && (
        <pre className="log-entry-context">{contextLines.join('\n')}</pre>
      )}
    </div>
  )
}
