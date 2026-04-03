import { useEffect, useRef } from 'react'
import './ProgressPanel.css'

interface ProgressEntry {
  stage: string
  message: string
}

interface Props {
  progress: ProgressEntry[]
}

export function ProgressPanel({ progress }: Props) {
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom as new messages arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progress])

  const currentStage = progress.length > 0 ? progress[progress.length - 1].stage : 'Initializing'
  const currentMessage = progress.length > 0 ? progress[progress.length - 1].message : 'Starting up...'

  return (
    <div className="progress-page">
      <div className="progress-container">
        <div className="progress-hero">
          <div className="spinner" />
          <div className="progress-stage-label">{currentStage}</div>
          <div className="progress-current-msg">{currentMessage}</div>
        </div>

        {progress.length > 0 && (
          <div className="progress-log-wrap card" ref={logRef}>
            <div className="progress-log-header">Activity Log</div>
            <ul className="progress-log">
              {progress.map((entry, i) => (
                <li key={i} className={`progress-log-entry${i === progress.length - 1 ? ' current' : ''}`}>
                  <span className="log-stage">{entry.stage}</span>
                  <span className="log-msg">{entry.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
