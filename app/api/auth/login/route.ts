import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { upsertUserProfile } from '@/lib/admin'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Generic message — do not leak Supabase error details (avoids user enumeration).
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }

  if (data.user?.id && data.user.email) {
    try {
      await upsertUserProfile(data.user.id, data.user.email)
    } catch (err) {
      console.error('[LOGIN] Profile upsert error:', err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ success: true, user: { id: data.user?.id, email: data.user?.email } })
}
