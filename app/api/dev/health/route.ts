import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

type ServiceCheck = {
  name: string
  url: string | null
  status: 'healthy' | 'degraded' | 'down' | 'unconfigured'
  latency_ms: number | null
}

async function pingService(name: string, url: string | null): Promise<ServiceCheck> {
  if (!url) return { name, url: null, status: 'unconfigured', latency_ms: null }

  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timeout)
    const latency_ms = Date.now() - start

    if (res.ok) return { name, url, status: 'healthy', latency_ms }
    return { name, url, status: 'degraded', latency_ms }
  } catch {
    return { name, url, status: 'down', latency_ms: Date.now() - start }
  }
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const services = [
    { name: 'UHP Ops Agent', url: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/health` : null },
    { name: 'Operative Core', url: process.env.OPERATIVE_CORE_URL ? `${process.env.OPERATIVE_CORE_URL}/api/health` : null },
    { name: 'ClipForge', url: process.env.CLIPFORGE_API_URL ? `${process.env.CLIPFORGE_API_URL}/api/health` : null },
    { name: 'Operative Builder', url: process.env.OPERATIVE_BUILDER_URL ? `${process.env.OPERATIVE_BUILDER_URL}/health` : null },
    { name: 'Operative Comms', url: process.env.OPERATIVE_COMMS_URL ? `${process.env.OPERATIVE_COMMS_URL}/api/health` : null },
    { name: 'Forge Ops', url: process.env.FORGE_OPS_URL ? `${process.env.FORGE_OPS_URL}/api/health` : null },
  ]

  const results = await Promise.all(services.map((s) => pingService(s.name, s.url)))

  return NextResponse.json({ services: results, checked_at: new Date().toISOString() })
}
