'use client'

import { usePathname } from 'next/navigation'

const ROUTE_BACKGROUNDS: Record<string, string> = {
  '/home': '/images/bg-campus.webp',
  '/overview': '/images/bg-campus.webp',
  '/admin/admissions': '/images/bg-flag.webp',
  '/admin/intake': '/images/bg-flag.webp',
  '/admin/onboarding': '/images/bg-flag.webp',
  '/students': '/images/bg-training.webp',
  '/admin/checkins': '/images/bg-training.webp',
  '/admin/scheduling': '/images/bg-campus.webp',
  '/admin/work-orders': '/images/bg-campus.webp',
  '/admin/rooms': '/images/bg-flag.webp',
  '/admin/spaces': '/images/bg-flag.webp',
  '/admin/badges': '/images/bg-campus.webp',
  '/admin/import': '/images/bg-campus.webp',
  '/admin/teams': '/images/bg-campus.webp',
  '/admin': '/images/bg-campus.webp',
  '/processes': '/images/bg-campus.webp',
  '/discovery': '/images/bg-training.webp',
  '/student/home': '/images/bg-flag.webp',
  '/student/checkin': '/images/bg-training.webp',
  '/student/badge': '/images/bg-campus.webp',
  '/student/schedule': '/images/bg-campus.webp',
  '/student/my-info': '/images/bg-flag.webp',
}

function getBackground(pathname: string): string | null {
  if (ROUTE_BACKGROUNDS[pathname]) return ROUTE_BACKGROUNDS[pathname]
  for (const [prefix, bg] of Object.entries(ROUTE_BACKGROUNDS)) {
    if (pathname.startsWith(prefix + '/')) return bg
  }
  return null
}

export default function PageBackground() {
  const pathname = usePathname()
  const bg = getBackground(pathname)
  if (!bg) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        backgroundImage: `url(${bg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        opacity: 0.06,
        filter: 'grayscale(60%)',
      }}
      aria-hidden
    />
  )
}
