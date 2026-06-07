import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const componentSlug = new URL(req.url).searchParams.get('component')?.trim() || ''
  const admin = getAdminClient()

  let query = admin
    .from('data_sources')
    .select('id, name, slug, kind, description, last_imported_at, components(name, slug)')
    .order('name')
  if (componentSlug) {
    const { data: comp } = await admin.from('components').select('id').eq('slug', componentSlug).maybeSingle()
    if (!comp) return NextResponse.json({ sources: [], component: null })
    query = query.eq('component_id', comp.id)
  }

  const [{ data: sources, error: srcErr }, { data: metricRows }, { data: issueRows }] = await Promise.all([
    query,
    admin.from('metrics').select('source_id'),
    admin.from('import_rows').select('source_id, status'),
  ])
  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 })

  const metricCount: Record<string, number> = {}
  for (const m of metricRows || []) if (m.source_id) metricCount[m.source_id] = (metricCount[m.source_id] || 0) + 1
  const issueCount: Record<string, number> = {}
  for (const r of issueRows || []) if (r.source_id && r.status !== 'ok') issueCount[r.source_id] = (issueCount[r.source_id] || 0) + 1

  const out = (sources || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    kind: s.kind,
    description: s.description,
    component: s.components?.name || null,
    lastImportedAt: s.last_imported_at,
    metricCount: metricCount[s.id] || 0,
    issueCount: issueCount[s.id] || 0,
  }))

  return NextResponse.json({ sources: out })
}
