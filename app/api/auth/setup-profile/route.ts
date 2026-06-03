import { createClient } from '@/lib/supabase/server'
import { upsertUserProfile } from '@/lib/admin'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    await upsertUserProfile(user.id, user.email!)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('setup-profile error:', err)
    return NextResponse.json({ error: 'Failed to create profile.' }, { status: 500 })
  }
}
