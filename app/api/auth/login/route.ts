import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { upsertUserProfile } from '@/lib/admin'

export async function POST(request: Request) {
  console.log('[LOGIN] Request received')
  console.log('[LOGIN] Env: NEXT_PUBLIC_SUPABASE_URL =', process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('[LOGIN] Env: NEXT_PUBLIC_SUPABASE_ANON_KEY exists =', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  console.log('[LOGIN] Attempting login for:', email)

  if (!email || !password) {
    console.log('[LOGIN] Missing email or password')
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const supabase = createClient()
  console.log('[LOGIN] Supabase client created, attempting signInWithPassword')

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    console.error('[LOGIN] Supabase auth error:', {
      message: error.message,
      status: error.status,
      code: error.code,
    })
    return NextResponse.json({ 
      error: error.message,
      details: { status: error.status, code: error.code }
    }, { status: 401 })
  }

  console.log('[LOGIN] Auth success, user:', data.user?.id)

  if (data.user?.id && data.user.email) {
    try {
      await upsertUserProfile(data.user.id, data.user.email)
      console.log('[LOGIN] User profile upserted successfully')
    } catch (err) {
      console.error('[LOGIN] Profile upsert error:', err instanceof Error ? err.message : String(err))
    }
  }

  const response = { success: true, user: { id: data.user?.id, email: data.user?.email } }
  console.log('[LOGIN] Returning success response')
  return NextResponse.json(response)
}
