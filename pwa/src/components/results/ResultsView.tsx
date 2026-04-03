import { useState } from 'react'
import type { ParseResult } from '../../worker/models'
import { FindingsPanel } from './FindingsPanel'
import { SystemPanel } from './SystemPanel'
import { NetworkPanel } from './NetworkPanel'
import { LicensingPanel } from './LicensingPanel'
import { DriversPanel } from './DriversPanel'
import { HardwareServicePanel } from './HardwareServicePanel'
import { CamerasPanel } from './CamerasPanel'
import { LogsPanel } from './LogsPanel'
import { ActivityPanel } from './ActivityPanel'
import { RawPanel } from './RawPanel'
import { VersionsPanel } from './VersionsPanel'
import './ResultsView.css'

const TABS = [
  { id: 'findings', label: 'Findings' },
  { id: 'system', label: 'System' },
  { id: 'versions', label: 'Versions' },
  { id: 'network', label: 'Network' },
  { id: 'licensing', label: 'Licensing' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'cameras', label: 'Cameras' },
  { id: 'logs', label: 'Logs' },
  { id: 'activity', label: 'Activity' },
  { id: 'raw', label: 'Raw JSON' },
] as const

type TabId = typeof TABS[number]['id']

interface Props {
  result: ParseResult
}

export function ResultsView({ result }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('findings')

  const criticalCount = result.findings.filter(f => f.severity === 'CRITICAL').length
  const warningCount = result.findings.filter(f => f.severity === 'WARNING').length
  const infoCount = result.findings.filter(f => f.severity === 'INFO').length

  return (
    <div className="results-view">
      {/* Summary bar */}
      <div className="results-summary-bar">
        <div className="summary-meta">
          {result.product_type && result.product_type !== 'Unknown' && (
            <span className="summary-chip">{result.product_type}</span>
          )}
          {result.tool_version && (
            <span className="summary-chip summary-chip-muted">Parser {result.tool_version}</span>
          )}
        </div>
        <div className="summary-counts">
          {criticalCount > 0 && (
            <span className="badge badge-critical">{criticalCount} Critical</span>
          )}
          {warningCount > 0 && (
            <span className="badge badge-warning">{warningCount} Warning</span>
          )}
          {infoCount > 0 && (
            <span className="badge badge-info">{infoCount} Info</span>
          )}
          {result.findings.length === 0 && (
            <span className="badge badge-ok">No findings</span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="results-tabs-wrap">
        <nav className="tab-bar" role="tablist" aria-label="Result sections">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'findings' && result.findings.length > 0 && (
                <span className="tab-count">{result.findings.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Panel content */}
      <div className="results-panel-area" id={`panel-${activeTab}`} role="tabpanel">
        {activeTab === 'findings' && <FindingsPanel result={result} />}
        {activeTab === 'system' && <SystemPanel result={result} />}
        {activeTab === 'versions' && <VersionsPanel result={result} />}
        {activeTab === 'network' && <NetworkPanel result={result} />}
        {activeTab === 'licensing' && <LicensingPanel result={result} />}
        {activeTab === 'drivers' && <DriversPanel result={result} />}
        {activeTab === 'hardware' && <HardwareServicePanel result={result} />}
        {activeTab === 'cameras' && <CamerasPanel result={result} />}
        {activeTab === 'logs' && <LogsPanel result={result} />}
        {activeTab === 'activity' && <ActivityPanel result={result} />}
        {activeTab === 'raw' && <RawPanel result={result} />}
      </div>
    </div>
  )
}
