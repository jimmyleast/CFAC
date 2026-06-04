'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [messages, setMessages] = useState([
    { role: 'morgan', content: 'Welcome to CFAC — the Children & Family Advocacy Center. I\'m your AI guide. Ask me anything about our programs, services, or how we can help.' },
  ])
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Check if user is already logged in → redirect to role-based home
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace('/home')
      } else {
        setChecking(false)
      }
    })
  }, [router])

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setInstalled(true))
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') setInstalled(true)
    setInstallPrompt(null)
  }

  if (checking) {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: '#0A0A0A', color: '#555' }}>Loading...</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F0EDE6', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans, "DM Sans", sans-serif)' }}>
      {/* Header */}
      <header style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, letterSpacing: '0.06em', color: '#C9A84C' }}>CFAC</span>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A8680', fontWeight: 600 }}>Data &amp; Operations</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {installPrompt && !installed && (
            <button onClick={handleInstall} style={{
              background: 'rgba(201,168,76,0.15)', border: '1px solid #C9A84C',
              color: '#C9A84C', padding: '8px 16px',
              fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              cursor: 'pointer',
            }}>
              Install App
            </button>
          )}
          {installed && (
            <span style={{
              fontSize: 11, color: '#C9A84C',
              fontFamily: 'var(--font-heading)', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              App Installed
            </span>
          )}
          <a href="/auth/login" style={{
            color: '#F0EDE6', textDecoration: 'none', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px',
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            Sign In
          </a>
        </div>
      </header>

      {/* Hero */}
      <div style={{ padding: '40px 24px 20px', textAlign: 'center' }}>
        <h1 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 700,
          lineHeight: 0.95, letterSpacing: '0.02em',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          Unlock Human Potential
        </h1>
        <p style={{ fontSize: 15, color: '#8A8680', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
          Veteran-focused trade education. Ask Morgan anything about our programs, campus, or how to get started.
        </p>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            {m.role === 'morgan' && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1AAFA0', border: '1px solid #1AAFA0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0, fontSize: 12, color: '#FFFFFF', fontWeight: 700 }}>M</div>
            )}
            <div style={{
              maxWidth: '80%', padding: '12px 16px', borderRadius: 0,
              background: m.role === 'user' ? 'rgba(255,255,255,0.06)' : 'rgba(26,175,160,0.06)',
              border: `1px solid ${m.role === 'user' ? 'rgba(255,255,255,0.1)' : 'rgba(26,175,160,0.15)'}`,
              fontSize: 14, lineHeight: 1.6, color: '#D7D3CC',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8A8680', fontSize: 13, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1AAFA0', border: '1px solid #1AAFA0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#FFFFFF', fontWeight: 700 }}>M</div>
            Morgan is typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 24px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', maxWidth: 640, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask anything about CFAC..."
            rows={1}
            style={{
              flex: 1, minHeight: 44, resize: 'none', fontSize: 15, padding: '10px 14px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 0, color: '#F0EDE6', fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button onClick={send} disabled={!text.trim() || loading} style={{
            minWidth: 44, height: 44, padding: 0, fontSize: 18, background: '#1AAFA0',
            color: '#0A0A0A', border: 'none', borderRadius: 0, cursor: 'pointer',
            fontWeight: 700, opacity: !text.trim() || loading ? 0.4 : 1,
          }}>→</button>
        </div>
      </div>
    </div>
  )
}
