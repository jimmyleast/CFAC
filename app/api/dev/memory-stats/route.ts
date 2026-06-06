import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

async function fetchMemoryStats(): Promise<Record<string, number>> {
  const coreUrl = process.env.OPERATIVE_CORE_URL
  const coreKey = process.env.OPERATIVE_CORE_KEY
  const deploymentId = process.env.OPERATIVE_DEPLOYMENT_ID || 'uhp-hope'

  if (!coreUrl || !coreKey) {
    console.warn('[dev/memory-stats] missing OPERATIVE_CORE_URL or OPERATIVE_CORE_KEY')
    return {}
  }

  // Try the /api/memory/stats endpoint first
  try {
    const statsUrl = `${coreUrl}/api/memory/stats?deployment_id=${encodeURIComponent(deploymentId)}`
    console.log(`[dev/memory-stats] trying ${statsUrl}`)
    const res = await fetch(statsUrl, {
      headers: { 'X-Core-Key': coreKey },
      cache: 'no-store',
    })

    if (res.ok) {
      const data = await res.json()
      console.log('[dev/memory-stats] stats endpoint response:', JSON.stringify(data))
      // Handle various response shapes
      if (data.stats) return data.stats
      if (data.counts) return data.counts
      if (typeof data === 'object') return data
    } else {
      console.log(`[dev/memory-stats] stats endpoint returned ${res.status}, falling back to search`)
    }
  } catch (err) {
    console.log('[dev/memory-stats] stats endpoint failed, falling back to search:', err)
  }

  // Fallback: search for each type with a broad query
  const types = ['episodic', 'procedural', 'semantic', 'outcome']
  const results: Record<string, number> = {}

  for (const type of types) {
    try {
      const searchUrl = `${coreUrl}/api/memory/search?deployment_id=${encodeURIComponent(deploymentId)}&q=*&type=${encodeURIComponent(type)}&limit=100`
      const res = await fetch(searchUrl, {
        headers: { 'X-Core-Key': coreKey },
        cache: 'no-store',
      })

      if (res.ok) {
        const data = await res.json()
        const items = data.results || data.memories || []
        results[type] = Array.isArray(items) ? items.length : 0
        console.log(`[dev/memory-stats] search type=${type} → ${results[type]} results`)
      } else {
        const text = await res.text().catch(() => '')
        console.log(`[dev/memory-stats] search type=${type} failed: ${res.status} ${text}`)
        results[type] = 0
      }
    } catch {
      results[type] = 0
    }
  }

  return results
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stats = await fetchMemoryStats()

  return NextResponse.json({
    stats: {
      episodic: stats.episodic ?? 0,
      procedural: stats.procedural ?? 0,
      semantic: stats.semantic ?? 0,
      outcome: stats.outcome ?? 0,
    },
  })
}
