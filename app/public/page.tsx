'use client'
import { useState, useRef, useEffect } from 'react'

export default function PublicMorgan() {
  const [messages, setMessages] = useState([{
    role: 'morgan',
    content: 'Welcome to UHP. What brings you here today?',
  }])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!text.trim()) return
    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setText('')
    setLoading(true)

    try {
      const res = await fetch('/api/morgan/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'morgan', content: data.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'morgan', content: 'I had trouble with that. Try again?' }])
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Morgan · UHP</span>
        </div>
        <nav style={{ display: 'flex', gap: 16 }}>
          <a href="/auth/login" style={{ color: 'var(--text-tertiary)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none' }}>Sign in</a>
        </nav>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            {m.role === 'morgan' && (
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
            Morgan is typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask me anything about UHP..."
            rows={1}
            className="textarea-field"
            style={{ flex: 1, minHeight: 44, resize: 'none', fontSize: 15 }}
          />
          <button onClick={send} disabled={!text.trim() || loading} className="btn btn-primary" style={{ minWidth: 44, height: 44, padding: 0, fontSize: 18 }}>→</button>
        </div>
      </div>
    </div>
  )
}
