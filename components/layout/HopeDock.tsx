'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import HopeVoiceButton from '@/components/HopeVoiceButton'

type HopeCard = {
  type: string
  actionId?: string | null
  title?: string
  summary?: string
  intent?: string
  status?: string
  requiresConfirmation?: boolean
  payload?: Record<string, unknown>
  preview?: unknown
}

type Message = {
  id: string
  role: 'user' | 'hope'
  text: string
  card?: HopeCard | null
  followups?: string[]
}

const GOLD = '#C9A84C'
const HOPE = '#1AAFA0'
const HOPE_GLOW = 'rgba(26,175,160,0.18)'
const BG = '#0A0A0A'
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'
const SUCCESS = '#059669'

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(opts.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  return fetch(url, { ...opts, headers })
}

export default function HopeDock() {
  const pathname = usePathname() || ''
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [cardBusy, setCardBusy] = useState(false)
  const [userInitials, setUserInitials] = useState('U')
  const [voiceBaseline, setVoiceBaseline] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    authFetch('/api/me').then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      const name: string = data?.display_name || data?.name || (data?.email || '').split('@')[0] || ''
      const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U'
      setUserInitials(initials)
    }).catch(() => {})
  }, [])

  const hidden = !pathname || pathname === '/' || pathname.startsWith('/auth') || pathname === '/hub'

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Auto-grow textarea as content wraps (up to maxHeight)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  if (hidden) return null

  function appendMessage(msg: Omit<Message, 'id'>) {
    setMessages((prev) => [...prev, { ...msg, id: `${Date.now()}-${Math.random()}` }])
  }

  function updateLastHope(text: string, card?: HopeCard | null) {
    setMessages((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'hope') {
          next[i] = { ...next[i], text, card: card ?? next[i].card }
          return next
        }
      }
      return next
    })
  }

  function updateLastHopeFollowups(followups: string[]) {
    setMessages((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'hope') {
          next[i] = { ...next[i], followups }
          return next
        }
      }
      return next
    })
  }

  function handleChipClick(messageId: string, label: string) {
    if (sending) return
    // Clear followups on the originating message so the user can't double-tap
    // or hit them against a now-stale answer.
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, followups: undefined } : m)))
    void send(label)
  }

  function handleVoiceTranscript(transcript: string) {
    const baseline = voiceBaseline ?? ''
    setInput(baseline.trim() ? `${baseline.trim()} ${transcript}` : transcript)
  }

  function handleVoiceListeningChange(listening: boolean) {
    setVoiceBaseline(listening ? input : null)
  }

  async function send(text?: string) {
    const fromChip = typeof text === 'string'
    const q = (fromChip ? text : input).trim()
    if (!q || sending) return
    if (!fromChip) setInput('')
    setSending(true)
    appendMessage({ role: 'user', text: q })
    appendMessage({ role: 'hope', text: '' })

    try {
      const res = await authFetch('/api/hope/unified', {
        method: 'POST',
        body: JSON.stringify({ query: q }),
      })

      if (!res.ok) {
        updateLastHope('Something went wrong.')
        setSending(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let lastCard: HopeCard | null = null

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.slice(6))
              if (parsed.token) {
                fullText += parsed.token
                updateLastHope(fullText, lastCard)
              }
              if (parsed.card) {
                lastCard = parsed.card
                updateLastHope(fullText, parsed.card)
              }
              if (Array.isArray(parsed.followups)) {
                updateLastHopeFollowups(parsed.followups)
              }
            } catch {}
          }
        }
      }
    } catch {
      updateLastHope('Network error.')
    }

    setSending(false)
  }

  async function resolveCard(message: Message, decision: 'confirm' | 'cancel') {
    if (!message.card?.actionId || cardBusy) return
    setCardBusy(true)
    try {
      const res = await authFetch('/api/hope/confirm', {
        method: 'POST',
        body: JSON.stringify({ actionId: message.card.actionId, decision }),
      })
      const data = await res.json().catch(() => ({}))
      setMessages((prev) => prev.map((m) =>
        m.id === message.id ? { ...m, card: null, text: (m.text ? m.text + '\n\n' : '') + (data.response || (decision === 'confirm' ? 'Confirmed.' : 'Cancelled.')) } : m
      ))
    } catch {
      // leave the card in place; the user can retry
    } finally {
      setCardBusy(false)
    }
  }

  const dockBottom = 20
  const dockRight = 24

  const panelStyle: React.CSSProperties = expanded
    ? {
        position: 'fixed',
        top: 16,
        right: 16,
        bottom: 16,
        left: 296,
        width: 'auto',
        height: 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
        background: BG2,
        border: `1px solid ${HOPE}`,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 0 40px rgba(0,0,0,0.6)',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transform: open ? 'none' : 'translateY(16px) scale(0.98)',
        transformOrigin: 'bottom right',
        transition: 'opacity 200ms ease-out, transform 240ms cubic-bezier(0.2,0.8,0.2,1), bottom 280ms cubic-bezier(0.2,0.8,0.2,1), right 280ms cubic-bezier(0.2,0.8,0.2,1), top 280ms cubic-bezier(0.2,0.8,0.2,1), left 280ms cubic-bezier(0.2,0.8,0.2,1)',
      }
    : {
        position: 'fixed',
        bottom: 88,
        right: dockRight,
        width: 460,
        maxWidth: 'calc(100vw - 48px)',
        height: 600,
        maxHeight: 'calc(100vh - 108px)',
        background: BG2,
        border: `1px solid ${HOPE}`,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 0 40px rgba(0,0,0,0.6)',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transform: open ? 'none' : 'translateY(16px) scale(0.96)',
        transformOrigin: 'bottom right',
        transition: 'opacity 200ms ease-out, transform 240ms cubic-bezier(0.2,0.8,0.2,1), bottom 280ms cubic-bezier(0.2,0.8,0.2,1), right 280ms cubic-bezier(0.2,0.8,0.2,1), top 280ms cubic-bezier(0.2,0.8,0.2,1), left 280ms cubic-bezier(0.2,0.8,0.2,1), width 280ms cubic-bezier(0.2,0.8,0.2,1), height 280ms cubic-bezier(0.2,0.8,0.2,1)',
      }

  return (
    <>
      {/* Chat panel */}
      <div role="dialog" aria-label="Hope chat" className="hope-panel" style={panelStyle}>
        {/* Header */}
        <div style={{ padding: '14px 14px 14px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, background: HOPE_GLOW, border: `1px solid ${HOPE}`,
            display: 'grid', placeItems: 'center', position: 'relative', flexShrink: 0,
          }}>
            <Icons.ChevronsUp size={20} color={HOPE} strokeWidth={1.5} />
          </div>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT }}>Hope</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, background: SUCCESS }} />
              Online
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className="hope-expand-btn"
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.22)', color: TEXT2,
                width: 36, height: 36, minWidth: 36, minHeight: 36,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT; (e.currentTarget as HTMLElement).style.borderColor = TEXT }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT2; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)' }}
            >
              {expanded ? <Icons.Minimize2 size={14} strokeWidth={1.5} /> : <Icons.Maximize2 size={14} strokeWidth={1.5} />}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setExpanded(false) }}
              aria-label="Close"
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.22)', color: TEXT2,
                width: 36, height: 36, minWidth: 36, minHeight: 36,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT; (e.currentTarget as HTMLElement).style.borderColor = TEXT }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT2; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)' }}
            >
              <Icons.X size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Thread */}
        <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.length === 0 && (
            <div style={{ color: TEXT2, fontSize: 13, textAlign: 'center', padding: '40px 16px' }}>
              Ask Hope anything — pull a number, check a program, or build a view from your data.
            </div>
          )}
          {messages.map((m) => {
            const showThinking = m.role === 'hope' && sending && !m.text
            return (
            <div
              key={m.id}
              style={{
                display: 'flex', gap: 10, maxWidth: '92%',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
              }}
            >
              <div style={{
                width: 26, height: 26,
                background: m.role === 'hope' ? HOPE_GLOW : BG3,
                border: `1px solid ${m.role === 'hope' ? HOPE : LINE2}`,
                display: 'grid', placeItems: 'center', flexShrink: 0,
                fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 10, color: TEXT,
              }}>
                {m.role === 'hope'
                  ? <Icons.ChevronsUp size={14} color={HOPE} strokeWidth={1.5} />
                  : userInitials}
              </div>
              <div style={{
                fontSize: 13, lineHeight: 1.55, color: TEXT,
                padding: '12px 14px',
                background: m.role === 'hope' ? 'rgba(26,175,160,0.08)' : 'rgba(255,255,255,0.025)',
                border: m.role === 'hope' ? 0 : `1px solid ${LINE}`,
                whiteSpace: 'pre-wrap',
              }}>
                {showThinking ? (
                  <span className="hope-thinking" aria-label="Hope is thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : m.text}
                {m.card && (
                  <div style={{ marginTop: 10, background: BG, border: `1px solid ${LINE}`, padding: '12px 14px', fontSize: 12 }}>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2, marginBottom: 8 }}>
                      {m.card.title || m.card.type}
                    </div>
                    {m.card.summary && <div style={{ marginBottom: 10 }}>{m.card.summary}</div>}
                    {m.card.requiresConfirmation && m.card.actionId && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          disabled={cardBusy}
                          onClick={() => resolveCard(m, 'confirm')}
                          style={{
                            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                            background: GOLD, border: `1px solid ${GOLD}`, color: BG, padding: '6px 12px', cursor: 'pointer',
                          }}
                        >Confirm</button>
                        <button
                          type="button"
                          disabled={cardBusy}
                          onClick={() => resolveCard(m, 'cancel')}
                          style={{
                            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                            background: 'transparent', border: `1px solid ${LINE2}`, color: TEXT, padding: '6px 12px', cursor: 'pointer',
                          }}
                        >Cancel</button>
                      </div>
                    )}
                  </div>
                )}
                {m.role === 'hope' && m.followups && m.followups.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {m.followups.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleChipClick(m.id, label)}
                        disabled={sending}
                        style={{
                          fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
                          padding: '5px 10px',
                          background: 'transparent',
                          border: `1px solid ${HOPE}`,
                          color: HOPE,
                          cursor: sending ? 'not-allowed' : 'pointer',
                          opacity: sending ? 0.5 : 1,
                          transition: 'background 120ms ease-out',
                        }}
                        onMouseEnter={(e) => { if (!sending) (e.currentTarget as HTMLElement).style.background = HOPE_GLOW }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )
          })}
        </div>

        {/* Input */}
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 12px 12px 16px', display: 'flex', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
            }}
            placeholder="Ask Hope anything..."
            rows={1}
            style={{
              flex: 1,
              background: BG,
              border: `1px solid ${LINE}`,
              color: TEXT,
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              lineHeight: 1.4,
              padding: '10px 12px',
              resize: 'none',
              minHeight: 40,
              maxHeight: 120,
              outline: 'none',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = HOPE)}
            onBlur={(e) => (e.currentTarget.style.borderColor = LINE)}
          />
          <HopeVoiceButton
            disabled={sending}
            onTranscript={handleVoiceTranscript}
            onListeningChange={handleVoiceListeningChange}
            size={40}
            label="Talk to Hope"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            aria-label="Send"
            style={{
              width: 40,
              height: 40,
              minWidth: 40,
              minHeight: 40,
              background: input.trim() && !sending ? HOPE : BG3,
              border: `1px solid ${input.trim() && !sending ? HOPE : LINE2}`,
              color: input.trim() && !sending ? BG : TEXT2,
              display: 'grid',
              placeItems: 'center',
              cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            <Icons.ArrowUp size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Dock pill (toggle) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close Hope' : 'Open Hope'}
        className="dock-hope-pill"
        style={{
          position: 'fixed',
          bottom: dockBottom,
          right: dockRight,
          height: 52,
          padding: '0 20px 0 16px',
          background: BG2,
          border: `1px solid ${HOPE}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          cursor: 'pointer',
          zIndex: 20,
          color: TEXT,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = BG3)}
        onMouseLeave={(e) => (e.currentTarget.style.background = BG2)}
      >
        <Icons.ChevronsUp
          size={22}
          color={HOPE}
          strokeWidth={1.5}
          style={{ transition: 'transform 240ms cubic-bezier(0.2,0.8,0.2,1)', transform: open ? 'rotate(180deg)' : 'none' }}
        />
        <span
          className="dock-label"
          style={{
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT, whiteSpace: 'nowrap',
          }}
        >
          Ask Hope
        </span>
      </button>
    </>
  )
}
