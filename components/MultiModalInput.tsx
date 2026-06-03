'use client'
import { useState, useRef } from 'react'

interface Props {
  onSend: (message: string, image?: string) => void
  disabled?: boolean
}

export default function MultiModalInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)

  function handleSend() {
    if (!text.trim() && !imagePreview) return
    onSend(text.trim(), imagePreview || undefined)
    setText('')
    setImagePreview(null)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Voice not supported. Use Chrome.'); return }
    const r = new SR()
    r.continuous = false; r.interimResults = true; r.lang = 'en-US'
    r.onstart = () => setIsRecording(true)
    r.onend = () => setIsRecording(false)
    r.onresult = (e: any) => {
      const t = Array.from(e.results).map((x: any) => x[0].transcript).join('')
      setText(t)
      if (e.results[e.results.length - 1].isFinal) {
        onSend(t, imagePreview || undefined)
        setText(''); setImagePreview(null); setIsRecording(false)
      }
    }
    r.onerror = () => setIsRecording(false)
    recognitionRef.current = r
    r.start()
  }

  function stopVoice() { recognitionRef.current?.stop() }

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const b64 = (ev.target?.result as string).split(',')[1]
      setImagePreview(b64)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="multimodal-input">
      {imagePreview && (
        <div className="image-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/jpeg;base64,${imagePreview}`} alt="preview" style={{ maxHeight: 120, borderRadius: 0, border: '1px solid var(--border)' }} />
          <button onClick={() => setImagePreview(null)} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}
      {isRecording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: 'var(--error)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--error)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
          <span style={{ fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Listening...</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type, talk, or show Morgan anything..."
          disabled={disabled || isRecording}
          rows={1}
          className="textarea-field"
          style={{ flex: 1, minHeight: 44, resize: 'none', fontSize: 15 }}
        />
        <button onClick={handleSend}
          disabled={disabled || (!text.trim() && !imagePreview)}
          className="btn btn-primary"
          style={{ minWidth: 44, height: 44, padding: 0, fontSize: 18 }}>→</button>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          style={{ background: isRecording ? 'var(--error)' : 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}
          onMouseDown={startVoice} onMouseUp={stopVoice}
          onTouchStart={startVoice} onTouchEnd={stopVoice}
          title="Hold to talk">🎤</button>
        <button
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}
          onClick={() => cameraRef.current?.click()}
          title="Take photo">📷</button>
        <button
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '6px 12px', cursor: 'pointer', fontSize: 16 }}
          onClick={() => fileRef.current?.click()}
          title="Upload file">📎</button>
        <input ref={fileRef} type="file" accept="image/*,.pdf"
          onChange={handleImage} style={{ display: 'none' }} />
        <input ref={cameraRef} type="file" accept="image/*"
          capture="environment" onChange={handleImage} style={{ display: 'none' }} />
      </div>
    </div>
  )
}
