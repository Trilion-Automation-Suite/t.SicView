declare const __APP_VERSION__: string

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ParseResult } from '../worker/models'
import { FileDropzone } from './FileDropzone'
import { ProgressPanel } from './ProgressPanel'
import { ResultsView } from './results/ResultsView'

// Worker message types (must match parse-worker.ts)
type WorkerInMsg = {
  type: 'parse'
  id: string
  fileBytes: Uint8Array
  filename: string
  product: string
  description: string | null
}

type WorkerOutMsg =
  | { type: 'ready' }
  | { type: 'progress'; id: string; stage: string; message: string }
  | { type: 'result'; id: string; result: string }
  | { type: 'error'; id: string; message: string }

type AppState =
  | { status: 'idle' }
  | { status: 'parsing'; progress: { stage: string; message: string }[] }
  | { status: 'done'; result: ParseResult; filename: string }
  | { status: 'error'; message: string }

export function App() {
  const [state, setState] = useState<AppState>({ status: 'idle' })
  const [darkMode, setDarkMode] = useState(true) // dark-first for this tool
  const workerRef = useRef<Worker | null>(null)
  const pendingIdRef = useRef<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Boot the worker once
  useEffect(() => {
    const worker = new Worker(new URL('../worker/parse-worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data
      if (msg.type === 'progress' && msg.id === pendingIdRef.current) {
        setState(s =>
          s.status === 'parsing'
            ? { ...s, progress: [...s.progress, { stage: msg.stage, message: msg.message }] }
            : s
        )
      } else if (msg.type === 'result' && msg.id === pendingIdRef.current) {
        const result = JSON.parse(msg.result) as ParseResult
        const filename = pendingIdRef.current?.split('::')[1] ?? 'archive'
        pendingIdRef.current = null
        setState({ status: 'done', result, filename })
      } else if (msg.type === 'error' && msg.id === pendingIdRef.current) {
        pendingIdRef.current = null
        setState({ status: 'error', message: msg.message })
      }
    }

    worker.onerror = (e) => {
      setState({ status: 'error', message: e.message || 'Worker error' })
    }

    return () => worker.terminate()
  }, [])

  const handleFile = useCallback(async (file: File, product = 'Unknown', description: string | null = null) => {
    if (!workerRef.current) return

    setState({ status: 'parsing', progress: [] })
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const id = `${Date.now()}::${file.name}`
    pendingIdRef.current = id

    const msg: WorkerInMsg = { type: 'parse', id, fileBytes, filename: file.name, product, description }
    workerRef.current.postMessage(msg, [fileBytes.buffer])
  }, [])

  const handleRetry = useCallback(() => setState({ status: 'idle' }), [])

  // Clipboard paste support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0]
      if (file) handleFile(file)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handleFile])

  const loadedFilename = state.status === 'done' ? state.filename : undefined

  return (
    <>
      <header className="app-header">
        <img src={`${import.meta.env.BASE_URL}icons/weblogo.png`} alt="Trilion" className="header-logo" />
        <span className="header-app-name">t.SicView</span>
        <span className="header-beta">BETA</span>
        <span className="header-subtitle">ZEISS Diagnostic Archive Viewer</span>
        {loadedFilename && (
          <span className="header-filename" title={loadedFilename}>{loadedFilename}</span>
        )}
        <div className="header-actions">
          {state.status === 'done' && (
            <button className="btn-ghost" onClick={handleRetry}>Load another</button>
          )}
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(d => !d)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {state.status === 'idle' && <FileDropzone onFile={handleFile} />}
        {state.status === 'parsing' && <ProgressPanel progress={state.progress} />}
        {state.status === 'error' && (
          <div className="app-error">
            <div className="error-box">
              <h2>Parse Error</h2>
              <p>{state.message}</p>
              <button className="btn-primary" onClick={handleRetry}>Try another file</button>
            </div>
          </div>
        )}
        {state.status === 'done' && <ResultsView result={state.result} />}
      </main>

      <footer className="app-footer">
        <span className="footer-version">t.SicView v{__APP_VERSION__}</span>
        <span className="footer-legal">INTERNAL USE ONLY — Files are processed locally and never transmitted.</span>
      </footer>
    </>
  )
}
