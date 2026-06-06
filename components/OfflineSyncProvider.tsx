'use client'

import { useEffect, useState } from 'react'

type QueuedMutation = {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
  createdAt: string
  attempts: number
  lastError?: string
}

const STORAGE_KEY = 'uhp-offline-mutation-queue-v1'
const REPLAY_HEADER = 'x-uhp-offline-replay'

declare global {
  interface Window {
    __uhpOfflineFetchPatched?: boolean
  }
}

export default function OfflineSyncProvider() {
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    setPending(readQueue().length)

    if (!window.__uhpOfflineFetchPatched) {
      window.__uhpOfflineFetchPatched = true
      patchFetch()
    }

    const updateStatus = () => {
      setOnline(navigator.onLine)
      setPending(readQueue().length)
    }

    const sync = async () => {
      setOnline(navigator.onLine)
      if (!navigator.onLine) {
        setPending(readQueue().length)
        return
      }
      setSyncing(true)
      await replayQueue()
      setPending(readQueue().length)
      setSyncing(false)
    }

    window.addEventListener('online', sync)
    window.addEventListener('offline', updateStatus)
    window.addEventListener('uhp-offline-queue-changed', updateStatus)

    void sync()
    const timer = window.setInterval(sync, 30000)

    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', updateStatus)
      window.removeEventListener('uhp-offline-queue-changed', updateStatus)
      window.clearInterval(timer)
    }
  }, [])

  if (online && pending === 0 && !syncing) return null

  return (
    <div style={{
      position: 'fixed',
      left: 16,
      bottom: 16,
      zIndex: 120,
      background: online ? '#141416' : '#261F12',
      color: online ? '#B6B1AA' : '#F4C15D',
      border: `1px solid ${online ? '#2A2A2A' : 'rgba(244,193,93,0.35)'}`,
      padding: '9px 12px',
      fontSize: 12,
      fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
      boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
      maxWidth: 320,
    }}>
      {!online
        ? `Offline mode: ${pending} update${pending === 1 ? '' : 's'} saved on this device.`
        : syncing
          ? `Syncing ${pending} pending update${pending === 1 ? '' : 's'}...`
          : `${pending} update${pending === 1 ? '' : 's'} waiting to sync.`}
    </div>
  )
}

function patchFetch() {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldQueue(input, init)) return originalFetch(input, init)

    if (!navigator.onLine) {
      const queued = queueMutation(input, init)
      return queuedResponse(queued)
    }

    try {
      return await originalFetch(input, init)
    } catch (error) {
      const queued = queueMutation(input, init, error instanceof Error ? error.message : 'Network request failed')
      return queuedResponse(queued)
    }
  }
}

function shouldQueue(input: RequestInfo | URL, init?: RequestInit) {
  const method = getMethod(input, init)
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false

  const url = getUrl(input)
  if (!url || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return false
  if (url.pathname.startsWith('/api/auth/')) return false
  if (url.pathname === '/api/hope/unified' || url.pathname === '/api/hope/chat') return false

  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  if (headers.has(REPLAY_HEADER)) return false

  const body = init?.body
  if (!body) return true
  if (typeof body === 'string') return true
  return false
}

function getMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function getUrl(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) return new URL(input.url)
    return new URL(String(input), window.location.origin)
  } catch {
    return null
  }
}

function queueMutation(input: RequestInfo | URL, init?: RequestInit, lastError?: string) {
  const url = getUrl(input)
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  const queueItem: QueuedMutation = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url: url ? `${url.pathname}${url.search}` : String(input),
    method: getMethod(input, init),
    headers: serializeHeaders(headers),
    body: typeof init?.body === 'string' ? init.body : null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError,
  }

  writeQueue([...readQueue(), queueItem])
  window.dispatchEvent(new Event('uhp-offline-queue-changed'))
  return queueItem
}

async function replayQueue() {
  const queue = readQueue()
  if (queue.length === 0) return

  const remaining: QueuedMutation[] = []
  for (const item of queue) {
    try {
      const headers = new Headers(item.headers)
      headers.set(REPLAY_HEADER, 'true')
      const res = await fetch(item.url, {
        method: item.method,
        headers,
        body: item.body,
        credentials: 'same-origin',
      })
      if (!res.ok) {
        remaining.push({ ...item, attempts: item.attempts + 1, lastError: `HTTP ${res.status}` })
      }
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : 'Replay failed',
      })
    }
  }

  writeQueue(remaining)
  window.dispatchEvent(new Event('uhp-offline-queue-changed'))
}

function readQueue(): QueuedMutation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedMutation[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-100)))
}

function serializeHeaders(headers: Headers) {
  const result: Record<string, string> = {}
  const contentType = headers.get('content-type')
  if (contentType) result['content-type'] = contentType
  return result
}

function queuedResponse(item: QueuedMutation) {
  return new Response(JSON.stringify({
    ok: true,
    offlineQueued: true,
    queued: true,
    id: item.id,
    message: 'Saved offline. This update will sync when the device is back online.',
  }), {
    status: 202,
    headers: {
      'Content-Type': 'application/json',
      'x-uhp-offline-queued': 'true',
    },
  })
}
