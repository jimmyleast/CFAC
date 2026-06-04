import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, DM_Sans, JetBrains_Mono } from 'next/font/google'
import AppChrome from '@/components/layout/AppChrome'
import PageBackground from '@/components/layout/PageBackground'
import MorganDock from '@/components/layout/MorganDock'
// Hidden 2026-05-30: bell shows but nothing reads notifications today. Write paths still active.
// import NotificationsDock from '@/components/layout/NotificationsDock'
import PWAInstallHelper from '@/components/PWAInstallHelper'
import OfflineSyncProvider from '@/components/OfflineSyncProvider'
import './globals.css'

const condensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-barlow-condensed',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-dm-sans',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
})

export const metadata: Metadata = {
  title: 'CFAC',
  description: 'Operations & data platform for CFAC staff',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CFAC',
  },
  icons: {
    apple: '/icons/icon-192.png',
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${condensed.variable} ${dmSans.variable} ${mono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0A0A0A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CFAC" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <PageBackground />
        <AppChrome>{children}</AppChrome>
        {/* <NotificationsDock /> */}
        <MorganDock />
        <PWAInstallHelper />
        <OfflineSyncProvider />
      </body>
    </html>
  )
}
