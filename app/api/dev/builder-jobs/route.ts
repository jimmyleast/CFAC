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

  const { data, error } = await adminClient
    .from('uhp_requests')
    .select('id, title, description, builder_job_id, builder_status, builder_result, created_at, updated_at')
    .not('builder_job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ jobs: data || [] })
}
