import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const adminClient = getAdminClient()

  const [processes, requests, recentUsers] = await Promise.all([
    adminClient
      .from('processes')
      .select('id, status, completion')
      .neq('category', 'request_ticket'),
    adminClient
      .from('uhp_requests')
      .select('id, status, builder_status'),
    adminClient
      .from('conversations')
      .select('process_id')
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
  ])

  const processRows = processes.data || []
  const requestRows = requests.data || []

  const sops_built = processRows.filter((p: any) => p.completion >= 100 || p.status === 'complete').length
  const sops_in_progress = processRows.filter((p: any) => (p.completion || 0) > 0 && (p.completion || 0) < 100 && p.status !== 'complete').length
  const requests_pending = requestRows.filter((r: any) => r.status === 'new' || r.status === 'scored').length
  const requests_building = requestRows.filter((r: any) => r.builder_status === 'pending' || r.builder_status === 'building').length
  const active_users = new Set((recentUsers.data || []).map((c: any) => c.process_id)).size

  return NextResponse.json({
    sops_built,
    sops_in_progress,
    requests_pending,
    requests_building,
    active_users,
  })
}
