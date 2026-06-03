'use client'

import { useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'

type SpeechRecognitionCtor = new () => any

interface MorganVoiceButtonProps {
  disabled?: boolean
  onTranscript: (transcript: string) => void
  onListeningChange?: (listening: boolean) => void
  size?: number
  label?: string
}

const TEAL = '#1AAFA0'
const BG = '#0A0A0A'
const BG3 = '#1A1A1A'
const LINE2 = '#3A3A3A'
const TEXT2 = '#8A8680'

export default function MorganVoiceButton({
  disabled = false,
  onTranscript,
  onListeningChange,
  size = 40,
  label = 'Voice input',
}: MorganVoiceButtonProps) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const activeRef = useRef(false)

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition()
    setSupported(Boolean(SpeechRecognition))
    return () => {
      try {
        recognitionRef.current?.abort?.()
      } catch {}
    }
  }, [])

  function startListening() {
    if (disabled || activeRef.current) return
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    finalRef.current = ''
    interimRef.current = ''

    const recognition = new SpeechRecognition()
    activeRef.current = true
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setListening(true)
      onListeningChange?.(true)
    }
    recognition.onerror = () => {
      activeRef.current = false
      setListening(false)
      onListeningChange?.(false)
    }
    recognition.onend = () => {
      activeRef.current = false
      setListening(false)
      onListeningChange?.(false)
      recognitionRef.current = null
    }
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = String(result?.[0]?.transcript || '')
        if (result.isFinal) finalRef.current += text
        else interim += text
      }
      interimRef.current = interim
      const transcript = (finalRef.current + interim).trim()
      if (transcript) onTranscript(transcript)
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  function stopListening() {
    if (!activeRef.current) return
    try {
      recognitionRef.current?.stop?.()
    } catch {
      activeRef.current = false
      setListening(false)
      onListeningChange?.(false)
    }
  }

  function toggle() {
    if (listening) stopListening()
    else startListening()
  }

  if (!supported) return null

  return (
    <>
      <style>{`
        @keyframes morganVoicePulse {
          0%   { opacity: 0.55; transform: scale(1); }
          100% { opacity: 0;    transform: scale(1.45); }
        }
      `}</style>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        title={listening ? 'Listening, tap to stop' : label}
        aria-label={listening ? 'Stop listening' : label}
        aria-pressed={listening}
        style={{
          position: 'relative',
          background: listening ? TEAL : BG3,
          color: listening ? BG : TEXT2,
          border: `1px solid ${listening ? TEAL : LINE2}`,
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          display: 'grid',
          placeItems: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        {listening && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: -4,
              border: `1px solid ${TEAL}`,
              pointerEvents: 'none',
              animation: 'morganVoicePulse 1.6s ease-out infinite',
            }}
          />
        )}
        <Icons.Mic size={16} strokeWidth={1.5} />
      </button>
    </>
  )
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null) as SpeechRecognitionCtor | null
}
