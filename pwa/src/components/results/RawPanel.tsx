import { useState, useCallback } from 'react'
import type { ParseResult } from '../../worker/models'
import './RawPanel.css'

interface Props {
  result: ParseResult
}

export function RawPanel({ result }: Props) {
  const [copied, setCopied] = useState(false)

  const json = JSON.stringify(result, null, 2)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }, [json])

  return (
    <div className="raw-panel">
      <div className="raw-toolbar">
        <span className="raw-label">Full ParseResult JSON</span>
        <button className="btn-ghost raw-copy-btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
      </div>
      <pre className="raw-pre card"><code>{json}</code></pre>
    </div>
  )
}
