import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { resolveComponentTiles } from '@/lib/metrics/tiles'

export const dynamic = 'force-dynamic'

// KPI tiles for one component (latest value + change vs prior period), scoped to
// that component's data sources. Aggregate metrics only — no PHI.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const slug = String(params.slug || '').trim()
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  try {
    const tiles = await resolveComponentTiles(getAdminClient(), slug)
    return NextResponse.json({ tiles })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load metrics' }, { status: 500 })
  }
}
