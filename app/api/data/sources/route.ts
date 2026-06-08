import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa, requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { slugify } from '@/lib/util/slug'
import { getSourceProfile, listSourceProfiles, profileForSourceSlug } from '@/lib/data/sourceProfiles'

export const dynamic = 'force-dynamic'

const KINDS = new Set(['spreadsheet', 'form', 'system', 'manual'])

// Register a new file/manual data source (admin). The "load your files" half of
// the connect portal — staff add a source (Collaborate export, a spreadsheet)
// then upload to it. Aggregate metadata only.
export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { name?: string; kind?: string; componentSlug?: string; description?: string; profileKey?: string }
  const name = String(body.name || '').trim().slice(0, 120)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : 'spreadsheet'
  const slug = slugify(name)
  if (!slug) return NextResponse.json({ error: 'name must contain letters or numbers' }, { status: 400 })
  const profile = getSourceProfile(body.profileKey) || profileForSourceSlug(slug)

  const admin = getAdminClient()
  const { data: existing } = await admin.from('data_sources').select('id').eq('slug', slug).maybeSingle()
  if (existing) return NextResponse.json({ error: 'a source with a similar name already exists' }, { status: 409 })

  let componentId: string | null = null
  if (body.componentSlug) {
    const { data: comp } = await admin.from('components').select('id').eq('slug', String(body.componentSlug)).maybeSingle()
    componentId = comp?.id ?? null
  }

  const { error } = await admin.from('data_sources').insert({
    name, slug, kind, description: String(body.description || '').slice(0, 500) || null, component_id: componentId,
    source_profile_key: profile?.key ?? null,
  })
  if (error) {
    // Lost a concurrent create race → the unique(slug) constraint rejected it.
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'a source with a similar name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await emitAppEvent({ eventName: 'source.created', category: 'system', userId: gate.user.id, route: '/api/data/sources', status: 'ok', metadata: { slug, kind, profileKey: profile?.key ?? null } }).catch(() => {})
  return NextResponse.json({ ok: true, slug, profileKey: profile?.key ?? null })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { slug?: string; profileKey?: string | null }
  const slug = String(body.slug || '').trim().slice(0, 120)
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const profileKey = body.profileKey ? String(body.profileKey).trim().slice(0, 120) : null
  if (profileKey && !getSourceProfile(profileKey)) return NextResponse.json({ error: 'known profileKey required' }, { status: 400 })

  const { data, error } = await getAdminClient()
    .from('data_sources')
    .update({ source_profile_key: profileKey })
    .eq('slug', slug)
    .select('id, slug, source_profile_key')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: `Unknown source: ${slug}` }, { status: 404 })

  await emitAppEvent({
    eventName: 'source.updated',
    category: 'system',
    userId: gate.user.id,
    route: '/api/data/sources',
    status: 'ok',
    metadata: { slug, profileKey },
  }).catch(() => {})
  return NextResponse.json({ ok: true, slug: data.slug, profileKey: data.source_profile_key })
}

export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const componentSlug = new URL(req.url).searchParams.get('component')?.trim() || ''
  const admin = getAdminClient()

  let query = admin
    .from('data_sources')
    .select('id, name, slug, kind, description, source_profile_key, last_imported_at, components(name, slug)')
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
    profileKey: s.source_profile_key || profileForSourceSlug(s.slug)?.key || null,
    component: s.components?.name || null,
    lastImportedAt: s.last_imported_at,
    metricCount: metricCount[s.id] || 0,
    issueCount: issueCount[s.id] || 0,
  }))

  return NextResponse.json({ sources: out, profiles: listSourceProfiles().map((p) => ({ key: p.key, name: p.name, mode: p.mode, description: p.description })) })
}
