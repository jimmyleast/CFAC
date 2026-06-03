import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRole, setUserRole, isValidRole, getHomeRoute } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = await getUserRole(user.id, user.email || '')

  return NextResponse.json({
    role,
    needs_onboarding: !role,
    redirect_url: role ? getHomeRoute(role) : '/onboarding',
  })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const role = typeof body.role === 'string' ? body.role.toLowerCase() : ''

  if (!isValidRole(role)) {
    return NextResponse.json({ error: 'Invalid role. Must be: student, staff, admin, or developer' }, { status: 400 })
  }

  await setUserRole(user.id, user.email || '', role)

  return NextResponse.json({
    role,
    redirect_url: getHomeRoute(role),
  })
}
