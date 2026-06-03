'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ───── tokens ─────
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT3 = '#555250'
const GOLD = '#C9A84C'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'

interface DocRecord {
  id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  ai_summary: string | null
  created_at: string
  source: 'process' | 'discovery'
  container_id: string
  container_name: string
  uploader_name: string
}

function formatBytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileGlyph(mime: string | null, name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf') || mime?.includes('pdf')) return 'PDF'
  if (n.endsWith('.docx') || n.endsWith('.doc') || mime?.includes('word')) return 'DOC'
  if (n.endsWith('.pptx') || n.endsWith('.ppt') || mime?.includes('presentation')) return 'PPT'
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || mime?.includes('spreadsheet')) return 'XLS'
  if (mime?.startsWith('image/')) return 'IMG'
  if (mime?.startsWith('video/')) return 'VID'
  return 'FILE'
}

function DocumentRowSkeleton() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'docShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number): React.CSSProperties => ({ ...shimmer, width: w, height: h })
  return (
    <tr style={{ borderBottom: `1px solid ${LINE}` }}>
      <td style={{ padding: '13px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ ...block(36, 36), border: `1px solid ${LINE}`, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={block('70%', 14)} />
            <div style={{ ...block('90%', 11), marginTop: 6 }} />
          </div>
        </div>
      </td>
      <td style={{ padding: '13px 16px' }}><div style={block(56, 11)} /></td>
      <td style={{ padding: '13px 16px' }}><div style={block(120, 12)} /></td>
      <td style={{ padding: '13px 16px' }}><div style={block(90, 12)} /></td>
      <td style={{ padding: '13px 16px' }}><div style={block(50, 11)} /></td>
      <td style={{ padding: '13px 16px' }}><div style={block(74, 11)} /></td>
      <td style={{ padding: '13px 16px' }}><div style={{ ...block(82, 28), border: `1px solid ${LINE2}` }} /></td>
    </tr>
  )
}

export default function AdminDocuments() {
  const router = useRouter()
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'process' | 'discovery'>('all')
  const [downloading, setDownloading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/documents')
    if (res.status === 401) { router.replace('/auth/login'); return }
    if (res.status === 403) { setError('Admin access required.'); setLoading(false); return }
    if (res.ok) { setDocs(await res.json()); setError('') }
    else setError('Failed to load documents.')
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  async function handleDownload(doc: DocRecord) {
    setDownloading(doc.id)
    try {
      const path = doc.source === 'process'
        ? `/api/upload/${doc.container_id}/${doc.id}`
        : `/api/discovery/${doc.container_id}/upload/${doc.id}`
      const res = await fetch(path)
      if (!res.ok) { alert('Could not generate download link.'); return }
      const { url } = await res.json()
      window.open(url, '_blank')
    } finally {
      setDownloading(null)
    }
  }

  const filtered = docs.filter(d => {
    if (sourceFilter !== 'all' && d.source !== sourceFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return d.file_name.toLowerCase().includes(q)
      || d.container_name.toLowerCase().includes(q)
      || d.source.toLowerCase().includes(q)
      || d.uploader_name.toLowerCase().includes(q)
  })

  const counts = {
    all: docs.length,
    process: docs.filter(d => d.source === 'process').length,
    discovery: docs.filter(d => d.source === 'discovery').length,
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 28px 100px', color: TEXT, fontFamily: 'var(--font-body)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Admin</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36, letterSpacing: '0.02em', textTransform: 'uppercase', margin: 0, lineHeight: 1.05 }}>Documents</h1>
          <p style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
            {docs.length} {docs.length === 1 ? 'file' : 'files'} uploaded across Process and Discovery workflows. Download originals or review AI summaries.
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 16, border: `1px solid rgba(220,38,38,0.4)`,
          background: 'rgba(220,38,38,0.08)', color: '#FCA5A5',
          padding: '10px 14px', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by file, source, context, or uploader..."
          style={{
            background: BG2, border: `1px solid ${LINE}`, padding: '10px 14px',
            color: TEXT, fontFamily: 'var(--font-body)', fontSize: 13,
            flex: 1, maxWidth: 380, outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = LINE2)}
          onBlur={e => (e.currentTarget.style.borderColor = LINE)}
        />
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['all', 'process', 'discovery'] as const).map(tab => (
            <button key={tab} onClick={() => setSourceFilter(tab)} style={{
              background: sourceFilter === tab ? BG2 : 'transparent',
              color: sourceFilter === tab ? TEXT : TEXT2,
              border: `1px solid ${sourceFilter === tab ? LINE2 : 'transparent'}`,
              padding: '7px 12px', fontFamily: 'var(--font-body)', fontSize: 12,
              cursor: 'pointer', textTransform: 'capitalize',
            }}>
              {tab} <span style={{ color: sourceFilter === tab ? TEXT2 : TEXT3, marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{counts[tab]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, overflow: 'auto' }}>
          <style>{`@keyframes docShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                {['File', 'Source', 'Context', 'Uploaded by', 'Size', 'Date', ''].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontFamily: 'var(--font-heading)', fontSize: 10,
                    color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map(i => <DocumentRowSkeleton key={i} />)}
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '60px 40px', textAlign: 'center', color: TEXT3 }}>
          {search ? `No documents match "${search}"` : 'No documents uploaded yet. Documents uploaded during Process and Discovery sessions will appear here.'}
        </div>
      ) : (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                {['File', 'Source', 'Context', 'Uploaded by', 'Size', 'Date', ''].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontFamily: 'var(--font-heading)', fontSize: 10,
                    color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc, i) => (
                <tr key={doc.id}
                  style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${LINE}` : 'none', transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = BG3)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{
                        width: 36, height: 36, background: BG3, border: `1px solid ${LINE2}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 10,
                        color: TEXT2, letterSpacing: '0.06em',
                      }}>{fileGlyph(doc.mime_type, doc.file_name)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: TEXT, fontWeight: 500, wordBreak: 'break-word', maxWidth: 280 }}>{doc.file_name}</div>
                        {doc.ai_summary && (
                          <div style={{ fontSize: 11, color: TEXT2, marginTop: 4, maxWidth: 280, lineHeight: 1.4 }} title={doc.ai_summary}>
                            {doc.ai_summary.length > 90 ? `${doc.ai_summary.slice(0, 90)}…` : doc.ai_summary}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{
                      fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 600,
                      color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.1em',
                    }}>{doc.source}</span>
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <button
                      onClick={() => router.push(doc.source === 'process' ? `/process/${doc.container_id}` : `/discovery/${doc.container_id}`)}
                      style={{
                        background: 'none', border: 'none', color: TEXT, cursor: 'pointer',
                        padding: 0, fontSize: 12, textAlign: 'left',
                        textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: TEXT3,
                      }}
                      title={doc.source === 'process' ? 'Open process' : 'Open discovery session'}
                    >
                      {doc.container_name}
                    </button>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: TEXT2 }}>{doc.uploader_name}</td>
                  <td style={{ padding: '13px 16px', fontSize: 11, color: TEXT2, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{formatBytes(doc.file_size)}</td>
                  <td style={{ padding: '13px 16px', fontSize: 11, color: TEXT2, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <button
                      onClick={() => handleDownload(doc)}
                      disabled={downloading === doc.id}
                      style={{
                        padding: '6px 12px', background: 'transparent',
                        border: `1px solid ${LINE2}`, color: TEXT,
                        fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 600,
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                        cursor: downloading === doc.id ? 'wait' : 'pointer',
                        opacity: downloading === doc.id ? 0.6 : 1, whiteSpace: 'nowrap',
                      }}
                    >
                      {downloading === doc.id ? 'Getting...' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
