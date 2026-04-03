import { useState, useRef, useCallback, DragEvent, ChangeEvent } from 'react'
import './FileDropzone.css'

const PRODUCTS = [
  'Unknown',
  'ATOS Q',
  'GOM Scan 1',
  'GOM Scan Ports',
  'T-SCAN',
  'ATOS Q AWK',
  'ARAMIS 4M',
  'ARAMIS 12M',
  'ARAMIS 24M',
  'ARAMIS SRX',
  'ARGUS',
] as const

interface Props {
  onFile: (file: File, product: string, description: string | null) => void
}

export function FileDropzone({ onFile }: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [product, setProduct] = useState<string>('Unknown')
  const [description, setDescription] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptFile = useCallback((file: File) => {
    const name = file.name.toLowerCase()
    if (name.endsWith('.zip') || name.endsWith('.tgz') || name.endsWith('.tar.gz')) {
      setPendingFile(file)
    } else {
      alert(`Unsupported file type: "${file.name}"\nExpected .zip, .tgz, or .tar.gz`)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) acceptFile(file)
  }, [acceptFile])

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) acceptFile(file)
    // Reset so the same file can be selected again after a retry
    e.target.value = ''
  }, [acceptFile])

  const handleAnalyze = useCallback(() => {
    if (!pendingFile) return
    onFile(pendingFile, product, description.trim() || null)
  }, [pendingFile, product, description, onFile])

  const handleClear = useCallback(() => {
    setPendingFile(null)
  }, [])

  return (
    <div className="dropzone-page">
      <div className="dropzone-container">
        <div className="dropzone-header">
          <h1 className="dropzone-title">t.SicView</h1>
          <p className="dropzone-tagline">
            Offline ZEISS diagnostic archive analyzer — your files never leave this device.
          </p>
        </div>

        {/* Drop target */}
        <div
          className={`dropzone-target${isDragOver ? ' drag-over' : ''}${pendingFile ? ' has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !pendingFile && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop archive file here or click to browse"
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !pendingFile) fileInputRef.current?.click() }}
        >
          {pendingFile ? (
            <div className="dropzone-file-info">
              <span className="file-icon">&#128194;</span>
              <span className="file-name" title={pendingFile.name}>{pendingFile.name}</span>
              <span className="file-size">{formatBytes(pendingFile.size)}</span>
              <button
                className="btn-ghost file-clear-btn"
                onClick={e => { e.stopPropagation(); handleClear() }}
                aria-label="Remove file"
              >
                &#x2715;
              </button>
            </div>
          ) : (
            <div className="dropzone-prompt">
              <span className="drop-icon">&#128229;</span>
              <span className="drop-main">Drop archive here</span>
              <span className="drop-sub">Supports .zip (full QSR report) and .tgz (gomsic archive)</span>
              <button
                className="btn-primary browse-btn"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                tabIndex={-1}
              >
                Browse...
              </button>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.tgz,.tar.gz"
          className="sr-only"
          onChange={handleInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Metadata form */}
        <div className="dropzone-form">
          <div className="form-row">
            <label className="form-label" htmlFor="product-select">
              Product / System
            </label>
            <select
              id="product-select"
              className="form-select"
              value={product}
              onChange={e => setProduct(e.target.value)}
            >
              {PRODUCTS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="description-input">
              Issue description <span className="form-label-optional">(optional)</span>
            </label>
            <textarea
              id="description-input"
              className="form-textarea"
              rows={3}
              placeholder="Describe the observed problem, error message, or behavior..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="dropzone-actions">
          <button
            className="btn-primary analyze-btn"
            onClick={handleAnalyze}
            disabled={!pendingFile}
          >
            Analyze Archive
          </button>
        </div>

        <p className="dropzone-hint">
          You can also paste a file with Ctrl+V
        </p>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
