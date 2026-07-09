'use client'
import { useState, useRef, useEffect } from 'react'

export default function PublicHope() {
  const [messages, setMessages] = useState([{
    role: 'hope',
    content: 'Welcome to CFAC. What brings you here today?',
  }])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const attachmentRef = useRef<HTMLInputElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!text.trim() && !attachment) return
    const userText = text.trim() || (attachment ? `Uploaded document: ${attachment.name}` : '')
    const userMsg = { role: 'user', content: userText }
    setMessages(prev => [...prev, userMsg])
    setText('')
    setLoading(true)

    try {
      let res: Response
      if (attachment) {
        const body = new FormData()
        body.append('message', text.trim() || 'Please review the attached document.')
        body.append('file', attachment)
        res = await fetch('/api/hope/public', { method: 'POST', body })
      } else {
        res = await fetch('/api/hope/public', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: messages }),
        })
      }
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'hope', content: data.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'hope', content: 'I had trouble with that. Try again?' }])
    }
    setAttachment(null)
    setLoading(false)
  }

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null
    setAttachment(file)
    e.currentTarget.value = ''
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>CFAC Assistant</span>
        </div>
        <nav style={{ display: 'flex', gap: 16 }}>
          <a href="/auth/login" style={{ color: 'var(--text-tertiary)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none' }}>Sign in</a>
        </nav>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            {m.role === 'hope' && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', marginTop: 8, marginRight: 8, flexShrink: 0 }} />
            )}
            <div style={{
              maxWidth: '80%',
              padding: '12px 16px',
              background: m.role === 'user' ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              border: `1px solid ${m.role === 'user' ? 'var(--border-strong)' : 'var(--border)'}`,
              color: 'var(--text-primary)',
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)' }} />
            Hope is typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        {attachment && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{attachment.name}</div>
            <button onClick={() => setAttachment(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-tertiary)', width: 28, height: 28, cursor: 'pointer' }} aria-label="Remove attachment">x</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask me anything about CFAC..."
            rows={1}
            className="textarea-field"
            style={{ flex: 1, minHeight: 44, resize: 'none', fontSize: 15 }}
          />
          <button onClick={() => attachmentRef.current?.click()} disabled={loading} style={{ minWidth: 44, height: 44, padding: '0 10px', fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: loading ? 'not-allowed' : 'pointer' }} aria-label="Upload document">Attach</button>
          <button onClick={send} disabled={(!text.trim() && !attachment) || loading} className="btn btn-primary" style={{ minWidth: 44, height: 44, padding: 0, fontSize: 18 }}>→</button>
          <input ref={attachmentRef} type="file" onChange={handleAttachmentChange} style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  )
}
