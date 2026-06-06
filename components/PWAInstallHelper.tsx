'use client'

import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'cfac-pwa-install-dismissed-session-v1'

function isStandalone() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function deviceMode() {
  if (typeof window === 'undefined') return 'unknown'
  const ua = window.navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
  const isSafari = /^((?!CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo).)*Safari/i.test(ua)
  const isChromeIOS = /CriOS/i.test(ua)
  if (isIOS && isSafari) return 'ios-safari'
  if (isIOS && isChromeIOS) return 'ios-chrome'
  return 'other'
}

function readDismissed() {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('install') === '1') return false
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {}
}

export default function PWAInstallHelper() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setDismissed(readDismissed())
    setStandalone(isStandalone())
    setOnline(navigator.onLine)

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
      setDismissed(readDismissed())
    }
    const onInstalled = () => {
      setStandalone(true)
      setPrompt(null)
    }
    const onDisplayChange = () => setStandalone(isStandalone())
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const media = window.matchMedia('(display-mode: standalone)')

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    media.addEventListener?.('change', onDisplayChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      media.removeEventListener?.('change', onDisplayChange)
    }
  }, [])

  const mode = useMemo(() => deviceMode(), [])

  function dismiss() {
    writeDismissed()
    setDismissed(true)
  }

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice.catch(() => null)
    setPrompt(null)
    dismiss()
  }

  if (!online) {
    return (
      <aside className="pwa-install-helper" role="status" aria-live="polite">
        <h2><span className="pwa-offline-dot" />Offline Mode</h2>
        <p>You are offline. Cached pages may still open, but live dashboard data will refresh when your connection returns.</p>
        <div className="pwa-install-actions">
          <button className="pwa-install-dismiss" onClick={dismiss}>Dismiss</button>
        </div>
      </aside>
    )
  }

  if (standalone || dismissed) return null

  if (mode === 'ios-safari') {
    return (
      <aside className="pwa-install-helper" aria-label="Install CFAC on iPhone">
        <h2>Add CFAC to iPhone</h2>
        <p>Tap Share, then Add to Home Screen. iPhone Safari controls installation, so there is no install button here.</p>
        <div className="pwa-install-actions">
          <button className="pwa-install-dismiss" onClick={dismiss}>Not now</button>
        </div>
      </aside>
    )
  }

  if (mode === 'ios-chrome') {
    return (
      <aside className="pwa-install-helper" aria-label="Open CFAC in Safari">
        <h2>Use Safari to Add CFAC</h2>
        <p>Chrome on iPhone cannot install web apps. Copy this link, open it in Safari, then tap Share and Add to Home Screen.</p>
        <div className="pwa-install-actions">
          <button className="pwa-install-dismiss" onClick={dismiss}>Got it</button>
        </div>
      </aside>
    )
  }

  if (!prompt) return null

  return (
    <aside className="pwa-install-helper" aria-label="Install CFAC">
      <h2>Install CFAC</h2>
      <p>Add CFAC to this device for a standalone staff app experience.</p>
      <div className="pwa-install-actions">
        <button className="pwa-install-dismiss" onClick={dismiss}>Not now</button>
        <button className="pwa-install-button" onClick={install}>Install</button>
      </div>
    </aside>
  )
}
