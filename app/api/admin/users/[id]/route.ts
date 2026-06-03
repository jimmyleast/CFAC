import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkIsAdmin } from '@/lib/admin'
import { getSupabasePublicConfig } from '@/lib/supabase/config'

export const runtime = 'nodejs'

function getAdminAuthClient() {
  const { url } = getSupabasePublicConfig()
  return createServiceClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** DELETE — sessions-only deactivate via Supabase auth ban_duration. Reversible. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targetId = params.id
  if (!targetId) return NextResponse.json({ error: 'user id required' }, { status: 400 })
  if (targetId === user.id) return NextResponse.json({ error: 'Cannot deactivate yourself.' }, { status: 400 })

  const sb = getAdminAuthClient()
  // 876000h ≈ 100 years — effectively permanent until reactivated
  const { error } = await sb.auth.admin.updateUserById(targetId, { ban_duration: '876000h' } as any)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deactivated: true })
}

/** POST — reactivate (clear the ban). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targetId = params.id
  if (!targetId) return NextResponse.json({ error: 'user id required' }, { status: 400 })

  const sb = getAdminAuthClient()
  const { error } = await sb.auth.admin.updateUserById(targetId, { ban_duration: 'none' } as any)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, reactivated: true })
}
