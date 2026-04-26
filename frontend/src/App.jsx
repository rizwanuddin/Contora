import { useState, useRef } from 'react'
import axios from 'axios'
import './index.css'

// ── tiny helpers ──────────────────────────────────────────────
const copy = (text) => navigator.clipboard.writeText(text)

function RatioBar({ ratio, required }) {
  const max = 21
  const pct = Math.min((ratio / max) * 100, 100)
  const color = ratio >= required ? '#3FCF8E' : ratio >= required * 0.7 ? '#F5A623' : '#F05252'
  return (
    <div className="ratio-bar-track mt-2">
      <div className="ratio-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function IssueCard({ issue, idx }) {
  const requiredNum = issue.required.includes('4.5') ? 4.5 : 3
  return (
    <div className={`issue-card ${issue.severity} fade-up`} style={{ animationDelay: `${idx * 0.05}s` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.5, flex: 1 }}>
          "{issue.text}"
        </p>
        <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Got <strong style={{ color: issue.severity === 'critical' ? '#F47F7F' : '#F5A623' }}>{issue.actual}</strong>
          &nbsp;— needs {issue.required}
        </span>
      </div>
      <RatioBar ratio={issue.ratio} required={requiredNum} />
    </div>
  )
}

// ── main app ──────────────────────────────────────────────────
export default function App() {
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [altText, setAltText] = useState('')
  const [longDescription, setLongDescription] = useState('')
  const [copied, setCopied] = useState(null)
  const fileInputRef = useRef(null)

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImage(file)
    setPreview(URL.createObjectURL(file))
    setResults(null)
    setError(null)
    setAltText('')
    setLongDescription('')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  const analyzeImage = async () => {
    if (!image) return
    setLoading(true)
    setError(null)
    const formData = new FormData()
    formData.append('image', image)
    try {
      const { data } = await axios.post('http://localhost:5001/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResults(data)
      setAltText(data.alt_text)
      setLongDescription(data.long_description)
    } catch (err) {
      setError(err.response?.data?.error || 'Analysis failed — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (text, key) => {
    copy(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1800)
  }

  const reset = () => {
    setImage(null); setPreview(null); setResults(null)
    setAltText(''); setLongDescription(''); setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const issueCount = results?.issues?.length || 0
  const passCount = results && issueCount === 0

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '4rem' }}>

      {/* ── HEADER ── */}
      <header style={{
        padding: '2rem 0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        marginBottom: '2.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 36, height: 36,
            background: 'var(--amber)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18
          }}>◈</div>
          <div>
            <h1 className="font-display" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
              AccessCanvas
            </h1>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Accessibility for creators
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ textAlign: 'right' }}>
            <p className="section-label" style={{ margin: 0 }}>WCAG 2.2 AA</p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>Compliance target</p>
          </div>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--green)',
            boxShadow: '0 0 8px rgba(63,207,142,0.6)'
          }} />
        </div>
      </header>

      {/* ── UPLOAD STATE ── */}
      {!preview && (
        <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: '3rem' }}>
          <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
            <div className="accent-line" style={{ margin: '0 auto 1.25rem' }} />
            <h2 className="font-display" style={{ margin: '0 0 0.5rem', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Check before you publish.
            </h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7 }}>
              Drop your thumbnail, banner, or poster. We'll check contrast, extract text,<br />and draft alt text — all before it goes live.
            </p>
          </div>

          <div
            className="upload-zone"
            style={{ padding: '4rem 2rem', textAlign: 'center' }}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFile(e.target.files[0])}
              accept="image/*"
              style={{ display: 'none' }}
            />
            <div style={{
              width: 64, height: 64,
              border: '1.5px solid rgba(245,166,35,0.3)',
              borderRadius: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
              fontSize: 28
            }}>🖼</div>
            <p className="font-display" style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '1rem' }}>
              Drop your image here
            </p>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.8rem' }}>
              PNG · JPG · WebP · up to 10MB
            </p>
          </div>

          {/* stat chips */}
          <div style={{ display: 'flex', gap: 12, marginTop: '1.5rem', justifyContent: 'center' }}>
            {['Contrast check', 'OCR extraction', 'Alt text draft'].map((label) => (
              <div key={label} style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 6
              }}>
                <span style={{ color: 'var(--amber)', fontSize: 10 }}>●</span> {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {preview && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>

          {/* ── COL 1: IMAGE + CONTROLS ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span className="section-label">Preview</span>
                <button onClick={reset} style={{
                  background: 'none', border: 'none', color: 'var(--text-dim)',
                  cursor: 'pointer', fontSize: '0.75rem', padding: 0
                }}>✕ clear</button>
              </div>
              <div style={{
                background: 'var(--surface-2)',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--border)'
              }}>
                <img
                  src={preview}
                  alt="Uploaded preview"
                  style={{ width: '100%', height: 'auto', maxHeight: 260, objectFit: 'contain', display: 'block' }}
                />
              </div>
            </div>

            <button
              onClick={analyzeImage}
              disabled={loading}
              className="btn-analyze"
            >
              {loading ? 'Analyzing…' : 'Run Analysis'}
            </button>

            {results && (
              <div className="card fade-up" style={{ padding: '1rem' }}>
                <span className="section-label">Summary</span>
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Issues found</span>
                    <span className={`badge badge-${issueCount > 0 ? 'critical' : 'pass'}`}>
                      {issueCount > 0 ? issueCount : '✓ none'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Text detected</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      {results.ocr_text?.trim() ? 'Yes' : 'None'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Alt text</span>
                    <span className="badge badge-pass">Drafted</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── COL 2: OCR + ISSUES ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* OCR */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.875rem' }}>
                <div className="accent-line" />
                <span className="section-label">Detected Text</span>
              </div>
              {!results && !loading && (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', margin: 0 }}>
                  Run analysis to extract text from your image.
                </p>
              )}
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.5rem 0' }}>
                  <div className="spinner" />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Running OCR…</span>
                </div>
              )}
              {results && (
                <div className="card-inner fade-up" style={{ padding: '0.875rem', maxHeight: 160, overflowY: 'auto' }}>
                  <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {results.ocr_text?.trim() || <span style={{ color: 'var(--text-dim)' }}>No text detected in image.</span>}
                  </p>
                </div>
              )}
            </div>

            {/* Issues */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="accent-line" />
                  <span className="section-label">Contrast Issues</span>
                </div>
                {results && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    {issueCount} found
                  </span>
                )}
              </div>

              {!results && !loading && (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', margin: 0 }}>
                  Contrast results will appear here.
                </p>
              )}
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="spinner" />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Checking contrast…</span>
                </div>
              )}

              {error && (
                <div style={{
                  background: 'rgba(240,82,82,0.08)',
                  border: '1px solid rgba(240,82,82,0.2)',
                  borderRadius: 10, padding: '0.875rem',
                  color: '#F47F7F', fontSize: '0.82rem'
                }}>
                  {error}
                </div>
              )}

              {results && issueCount === 0 && (
                <div style={{
                  background: 'rgba(63,207,142,0.06)',
                  border: '1px solid rgba(63,207,142,0.15)',
                  borderRadius: 10, padding: '1rem',
                  textAlign: 'center'
                }}>
                  <p style={{ margin: 0, color: 'var(--green)', fontSize: '0.9rem', fontWeight: 500 }}>✓ All contrast checks passed</p>
                  <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: '0.75rem' }}>WCAG AA compliant</p>
                </div>
              )}

              {results && issueCount > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
                  {results.issues.map((issue, idx) => (
                    <IssueCard key={idx} issue={issue} idx={idx} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── COL 3: ALT TEXT + PLAIN LANGUAGE ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Alt text */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="accent-line" />
                  <span className="section-label">Short Alt Text</span>
                </div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>for alt= attribute</span>
              </div>
              <textarea
                className="ac-textarea"
                rows={3}
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder={results ? '' : 'Analyze an image to generate alt text…'}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-copy" onClick={() => handleCopy(altText, 'alt')}>
                  {copied === 'alt' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Long description */}
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="accent-line" />
                  <span className="section-label">Long Description</span>
                </div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>for screen readers</span>
              </div>
              <textarea
                className="ac-textarea"
                rows={5}
                value={longDescription}
                onChange={(e) => setLongDescription(e.target.value)}
                placeholder={results ? '' : 'Detailed description will appear here…'}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-copy" onClick={() => handleCopy(longDescription, 'long')}>
                  {copied === 'long' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Plain language */}
            {results && issueCount > 0 && (
              <div className="card fade-up-2" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.875rem' }}>
                  <div className="accent-line" />
                  <span className="section-label">Plain English Fixes</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {results.issues.slice(0, 4).map((issue, idx) => (
                    <div key={idx} style={{
                      background: 'var(--surface-2)',
                      borderRadius: 10,
                      padding: '0.875rem',
                      borderLeft: `2px solid ${issue.severity === 'critical' ? 'var(--red)' : 'var(--yellow)'}`
                    }}>
                      <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        "{issue.text.slice(0, 40)}{issue.text.length > 40 ? '…' : ''}"
                      </p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
                        The contrast ratio is <strong style={{ color: issue.severity === 'critical' ? '#F47F7F' : '#F5A623' }}>{issue.actual}</strong>.
                        Try darkening the text or lightening the background so the difference is at least <strong>{issue.required.split(' ')[0]}</strong>.
                        People with low vision may not be able to read this as-is.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All clear state */}
            {results && issueCount === 0 && (
              <div className="card fade-up-3" style={{ padding: '1.25rem', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                <p className="font-display" style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem' }}>
                  Looking good!
                </p>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No contrast issues found. Edit and copy your alt text above.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── FOOTER ── */}
      <footer style={{
        textAlign: 'center',
        marginTop: '4rem',
        paddingTop: '2rem',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-dim)',
        fontSize: '0.72rem',
        letterSpacing: '0.06em'
      }}>
        ACCESSCANVAS — BUILT FOR CREATORS, DESIGNED FOR EVERYONE
      </footer>
    </div>
  )
}