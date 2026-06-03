import { createClient } from '@/lib/supabase/server'
import { getAdminClient, isAdminEmail } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ProcessDoc = {
  id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  ai_summary: string | null
  created_at: string
  process_id: string
  uploaded_by: string | null
}

type DiscoveryDoc = {
  id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  ai_summary: string | null
  created_at: string
  session_id: string
  uploaded_by: string | null
}

/** GET /api/admin/documents — all uploaded documents across process + discovery (admin only) */
export async function GET(_req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getAdminClient()
  const { data: profile } = await adminClient
    .from('user_profiles')
    .select('email, is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin && !isAdminEmail(profile?.email ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: processDocs, error: processError }, { data: discoveryDocs, error: discoveryError }] = await Promise.all([
    adminClient
      .from('process_documents')
      .select('id, file_name, file_size, mime_type, ai_summary, created_at, process_id, uploaded_by')
      .order('created_at', { ascending: false })
      .limit(500),
    adminClient
      .from('discovery_documents')
      .select('id, file_name, file_size, mime_type, ai_summary, created_at, session_id, uploaded_by')
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  if (processError) return NextResponse.json({ error: processError.message }, { status: 500 })
  if (discoveryError) return NextResponse.json({ error: discoveryError.message }, { status: 500 })

  const safeProcessDocs = (processDocs || []) as ProcessDoc[]
  const safeDiscoveryDocs = (discoveryDocs || []) as DiscoveryDoc[]
  if (!safeProcessDocs.length && !safeDiscoveryDocs.length) return NextResponse.json([])

  // Hydrate process/session names
  const processIds = [...new Set(safeProcessDocs.map(d => d.process_id))]
  const sessionIds = [...new Set(safeDiscoveryDocs.map(d => d.session_id))]

  const [{ data: processes }, { data: sessions }] = await Promise.all([
    processIds.length
      ? adminClient.from('processes').select('id, name').in('id', processIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    sessionIds.length
      ? adminClient.from('discovery_sessions').select('id, name').in('id', sessionIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }>, error: null }),
  ])

  // Hydrate uploader display names
  const uploaderIds = [...new Set([...safeProcessDocs.map(d => d.uploaded_by), ...safeDiscoveryDocs.map(d => d.uploaded_by)].filter(Boolean))]

  const { data: profiles } = uploaderIds.length
    ? await adminClient
        .from('user_profiles')
        .select('id, display_name, email')
        .in('id', uploaderIds)
    : { data: [] as Array<{ id: string; display_name: string | null; email: string | null }> }

  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.display_name || p.email || 'Unknown']))
  const processMap = Object.fromEntries((processes ?? []).map(p => [p.id, p.name]))
  const sessionMap = Object.fromEntries((sessions ?? []).map(s => [s.id, s.name || 'Discovery Session']))

  const processRows = safeProcessDocs.map(d => ({
    ...d,
    source: 'process' as const,
    container_id: d.process_id,
    container_name: processMap[d.process_id] ?? 'Unknown Process',
    uploader_name: d.uploaded_by ? (profileMap[d.uploaded_by] ?? 'Unknown') : 'Unknown',
  }))

  const discoveryRows = safeDiscoveryDocs.map(d => ({
    ...d,
    source: 'discovery' as const,
    container_id: d.session_id,
    container_name: sessionMap[d.session_id] ?? 'Discovery Session',
    uploader_name: d.uploaded_by ? (profileMap[d.uploaded_by] ?? 'Unknown') : 'Unknown',
  }))

  const result = [...processRows, ...discoveryRows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 500)

  return NextResponse.json(result)
}
