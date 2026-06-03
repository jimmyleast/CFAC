import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const ENV_VARS = [
  'OPERATIVE_CORE_URL',
  'OPERATIVE_CORE_KEY',
  'OPERATIVE_BUILDER_URL',
  'OPERATIVE_BUILDER_API_KEY',
  'CLIPFORGE_API_URL',
  'CLIPFORGE_API_KEY',
  'OPERATIVE_COMMS_URL',
  'OPERATIVE_COMMS_KEY',
  'OPERATIVE_PUBLISH_URL',
  'OPERATIVE_PUBLISH_KEY',
  'FORGE_OPS_URL',
  'FORGE_OPS_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'META_APP_ID',
  'META_APP_SECRET',
  'ADMIN_EMAILS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
]

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const vars = ENV_VARS.map((key) => ({ key, set: Boolean(process.env[key]) }))

  return NextResponse.json({ vars })
}
