import { useState, useRef } from 'react'
import axios from 'axios'
import './index.css'

function App() {
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [altText, setAltText] = useState('')
  const [longDescription, setLongDescription] = useState('')
  const fileInputRef = useRef(null)

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setImage(file)
      setPreview(URL.createObjectURL(file))
      setResults(null)
      setError(null)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      setImage(file)
      setPreview(URL.createObjectURL(file))
      setResults(null)
      setError(null)
      if (fileInputRef.current) {
        fileInputRef.current.files = e.dataTransfer.files
      }
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const analyzeImage = async () => {
    if (!image) return

    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append('image', image)

    try {
      const response = await axios.post('http://localhost:5001/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResults(response.data)
      setAltText(response.data.alt_text)
      setLongDescription(response.data.long_description)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to analyze image')
    } finally {
      setLoading(false)
    }
  }

  const resetUpload = () => {
    setImage(null)
    setPreview(null)
    setResults(null)
    setAltText('')
    setLongDescription('')
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6">
      {/* Header */}
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          AccessCanvas
        </h1>
        <p className="text-slate-400 mt-2">
          Accessibility dashboard for digital creators
        </p>
      </header>

      {/* Upload Area - Shows when no image */}
      {!preview && (
        <div
          className="border-2 border-dashed border-slate-600 rounded-2xl p-12 text-center max-w-2xl mx-auto cursor-pointer hover:border-purple-500 transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
          <div className="text-6xl mb-4">📷</div>
          <h2 className="text-xl font-semibold mb-2">Upload an image</h2>
          <p className="text-slate-400">
            Drag and drop or click to select a PNG, JPG, or WebP file
          </p>
        </div>
      )}

      {/* Dashboard - Shows when image is uploaded */}
      {preview && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* Left Column - Image Preview */}
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Image Preview</h2>
              <button
                onClick={resetUpload}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                ✕ Clear
              </button>
            </div>
            <div className="relative rounded-xl overflow-hidden bg-slate-700">
              <img
                src={preview}
                alt="Uploaded preview"
                className="w-full h-auto max-h-[400px] object-contain"
              />
            </div>
            <button
              onClick={analyzeImage}
              disabled={loading}
              className="w-full mt-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-all"
            >
              {loading ? 'Analyzing...' : 'Analyze Accessibility'}
            </button>
          </div>

          {/* Middle Column - OCR Text & Issues */}
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">OCR Results</h2>

            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 text-red-300 mb-4">
                {error}
              </div>
            )}

            {!results && !loading && (
              <p className="text-slate-400 text-center py-8">
                Click "Analyze Accessibility" to process the image
              </p>
            )}

            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin text-4xl mb-4">⏳</div>
                <p className="text-slate-400">Running OCR and contrast analysis...</p>
              </div>
            )}

            {results && (
              <div className="space-y-4">
                {/* OCR Text */}
                <div className="bg-slate-700 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-purple-400 mb-2">Detected Text</h3>
                  <p className="text-slate-200 whitespace-pre-wrap">
                    {results.ocr_text || 'No text detected'}
                  </p>
                </div>

                {/* Issues */}
                <div className="bg-slate-700 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-pink-400 mb-2">
                    Accessibility Issues ({results.issues?.length || 0})
                  </h3>
                  {results.issues?.length > 0 ? (
                    <ul className="space-y-2">
                      {results.issues.map((issue, idx) => (
                        <li key={idx} className="bg-slate-600 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              issue.severity === 'critical'
                                ? 'bg-red-500/30 text-red-300'
                                : 'bg-yellow-500/30 text-yellow-300'
                            }`}>
                              {issue.severity}
                            </span>
                            <span className="text-xs text-slate-400">
                              {issue.type === 'contrast' && `Ratio: ${issue.actual}`}
                            </span>
                          </div>
                          <p className="text-sm">
                            <span className="text-slate-400">Text:</span> "{issue.text}"
                          </p>
                          {issue.type === 'contrast' && (
                            <p className="text-xs text-slate-400 mt-1">
                              Needs {issue.required}, actual is {issue.actual}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-400 text-center py-2">✓ No issues found</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Alt Text & Descriptions */}
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">AI-Generated Drafts</h2>
            <p className="text-xs text-slate-400 mb-4">Edit any text before using</p>

            {!results && !loading && (
              <p className="text-slate-400 text-center py-8">
                Analyze an image to generate alt text
              </p>
            )}

            {results && (
              <div className="space-y-4">
                {/* Alt Text */}
                <div className="bg-slate-700 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-purple-400 mb-2">
                    Alt Text
                  </label>
                  <textarea
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    className="w-full bg-slate-600 text-white rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={3}
                    placeholder="Enter alt text..."
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    Brief description for screen readers
                  </p>
                </div>

                {/* Long Description */}
                <div className="bg-slate-700 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-purple-400 mb-2">
                    Long Description
                  </label>
                  <textarea
                    value={longDescription}
                    onChange={(e) => setLongDescription(e.target.value)}
                    className="w-full bg-slate-600 text-white rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={5}
                    placeholder="Enter long description..."
                  />
                  <p className="text-xs text-slate-400 mt-2">
                    Detailed description for complex images
                  </p>
                </div>

                {/* Plain Language Explanation */}
                {results.issues?.length > 0 && (
                  <div className="bg-slate-700 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-pink-400 mb-2">
                      Plain Language Explanation
                    </h3>
                    <div className="space-y-2 text-sm text-slate-300">
                      {results.issues.map((issue, idx) => (
                        <p key={idx}>
                          {issue.type === 'contrast' && (
                            <>
                              <strong>The text "{issue.text}"</strong> might be hard to read. The
                              contrast ratio is {issue.actual}, but it should be at least{' '}
                              <strong>{issue.required.split(' ')[0]}</strong> for WCAG compliance.
                              Try increasing the color difference between text and background.
                            </>
                          )}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-slate-500 text-sm mt-12">
        AccessCanvas — Helping creators build accessible content
      </footer>
    </div>
  )
}

export default App
