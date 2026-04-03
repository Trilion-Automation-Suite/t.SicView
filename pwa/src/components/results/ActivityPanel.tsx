import { useState } from 'react'
import type { ParseResult, ActivityEvent } from '../../worker/models'
import './Results.css'

interface Props {
  result: ParseResult
}

const CATEGORY_COLORS: Record<string, string> = {
  project: '#5090e0',
  measurement: '#40b070',
  calibration: '#f0a040',
  error: '#e84040',
  software: '#9060c0',
  system: '#7a84a8',
  export: '#20a8c0',
  import: '#20a8c0',
}

function categoryColor(cat: string): string {
  const lower = cat.toLowerCase()
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#7a84a8'
}

export function ActivityPanel({ result }: Props) {
  const { activity_timeline } = result

  if (!activity_timeline) {
    return (
      <div className="card panel-placeholder">No activity timeline data available.</div>
    )
  }

  return (
    <div className="panel-stack">
      <SummaryCard timeline={activity_timeline} />
      <TimelineCard events={activity_timeline.events} />
      {Object.keys(activity_timeline.command_summary).length > 0 && (
        <CommandFrequencyCard summary={activity_timeline.command_summary} />
      )}
    </div>
  )
}

/* ---- Summary ---- */
function SummaryCard({ timeline }: { timeline: NonNullable<ParseResult['activity_timeline']> }) {
  return (
    <section className="card">
      <h2 className="panel-heading">Summary</h2>
      <div className="stat-summary">
        <div className="stat-item">
          <span className="stat-label">Total Commands</span>
          <span className="stat-value">{timeline.total_commands.toLocaleString()}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Hangs</span>
          <span className={`stat-value${timeline.hang_count > 0 ? ' stat-value--critical' : ' stat-value--ok'}`}>
            {timeline.hang_count}
          </span>
        </div>
        {timeline.stage_count != null && (
          <div className="stat-item">
            <span className="stat-label">Stages</span>
            <span className="stat-value">{timeline.stage_count}</span>
          </div>
        )}
      </div>
      {(timeline.last_action ?? timeline.last_project) && (
        <dl className="info-grid" style={{ marginTop: 12 }}>
          {timeline.last_action && (
            <>
              <dt className="info-label">Last Action</dt>
              <dd className="info-value">{timeline.last_action}</dd>
            </>
          )}
          {timeline.last_project && (
            <>
              <dt className="info-label">Last Project</dt>
              <dd className="info-value"><code>{timeline.last_project}</code></dd>
            </>
          )}
          {timeline.project_size && (
            <>
              <dt className="info-label">Project Size</dt>
              <dd className="info-value">{timeline.project_size}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}

/* ---- Timeline ---- */
function TimelineCard({ events }: { events: ActivityEvent[] }) {
  const [showAll, setShowAll] = useState(false)

  if (events.length === 0) {
    return (
      <section className="card">
        <h2 className="panel-heading">Timeline</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No timeline events.</p>
      </section>
    )
  }

  // Most recent first
  const reversed = [...events].reverse()
  const visible = showAll ? reversed : reversed.slice(0, 50)

  return (
    <section className="card">
      <h2 className="panel-heading">
        Timeline ({events.length} events{!showAll && events.length > 50 ? ', showing 50' : ''})
      </h2>
      <div className="timeline-list">
        {visible.map((evt, i) => (
          <TimelineItem key={i} event={evt} />
        ))}
      </div>
      {!showAll && events.length > 50 && (
        <button className="show-all-btn" onClick={() => setShowAll(true)}>
          Show all {events.length} events
        </button>
      )}
    </section>
  )
}

function TimelineItem({ event }: { event: ActivityEvent }) {
  const color = categoryColor(event.category)

  return (
    <div className="timeline-item">
      {event.timestamp && (
        <div className="timeline-ts">{event.timestamp}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          className="badge"
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}44`,
          }}
        >
          {event.category}
        </span>
        <span className="timeline-action">{event.action}</span>
      </div>
      {event.detail && (
        <div className="timeline-detail">{event.detail}</div>
      )}
    </div>
  )
}

/* ---- Command Frequency ---- */
function CommandFrequencyCard({ summary }: { summary: Record<string, number> }) {
  const sorted = Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const maxCount = sorted[0]?.[1] ?? 1

  return (
    <section className="card">
      <h2 className="panel-heading">Top Commands</h2>
      <div className="bar-chart">
        {sorted.map(([cmd, count]) => (
          <div key={cmd} className="bar-chart-row">
            <span className="bar-chart-label" title={cmd}>{cmd}</span>
            <div className="bar-chart-bar-track">
              <div
                className="bar-chart-bar-fill"
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
            <span className="bar-chart-count">{count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
