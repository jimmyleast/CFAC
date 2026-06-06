import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function parsePool(value: string | undefined) {
  return (value || '')
    .split(/[\n,;|]/)
    .map((v) => v.trim())
    .filter(Boolean)
}

export async function GET() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const defaultAvatar =
    process.env.NEXT_PUBLIC_HEYGEN_AVATAR_ID ||
    process.env.HEYGEN_AVATAR_ID ||
    'Anna_public_3_20240108'
  const defaultVoice =
    process.env.NEXT_PUBLIC_HEYGEN_VOICE_ID ||
    process.env.HEYGEN_VOICE_ID ||
    '1bd001e7e50f421d891986aad5158bc8'

  return NextResponse.json({
    defaultAvatar,
    defaultVoice,
    avatarPool: parsePool(process.env.NEXT_PUBLIC_HEYGEN_AVATAR_POOL || process.env.HEYGEN_AVATAR_POOL),
    voicePool: parsePool(process.env.NEXT_PUBLIC_HEYGEN_VOICE_POOL || process.env.HEYGEN_VOICE_POOL),
  })
}
