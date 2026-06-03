import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const before = searchParams.get('before')

  const adminClient = getAdminClient()

  let query = adminClient
    .from('app_events')
    .select('id, event_name, category, status, route, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(50)

  if (before) {
    query = query.lt('created_at', before)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entries: data || [] })
}
