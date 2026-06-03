import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

type FeatureFlagRow = {
  key: string
  description: string | null
  enabled: boolean
  rollout_percent: number
  target_roles: string[] | null
  allowed_user_ids: string[] | null
  updated_at: string
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

async function ensureAdmin() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}

export async function GET() {
  const auth = await ensureAdmin()
  if (auth.error) return auth.error

  const adminClient = getAdminClient()
  const { data, error } = await adminClient
    .from('feature_flags')
    .select('key, description, enabled, rollout_percent, target_roles, allowed_user_ids, updated_at')
    .order('key', { ascending: true })

  if (error) {
    const message = error.message || ''
    if (message.includes('relation') && message.includes('feature_flags')) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json((data || []) as FeatureFlagRow[])
}

export async function PATCH(request: Request) {
  const auth = await ensureAdmin()
  if (auth.error) return auth.error

  const body = await request.json().catch(() => ({}))
  const key = typeof body.key === 'string' ? body.key.trim() : ''

  if (!key) {
    return NextResponse.json({ error: 'Feature flag key is required.' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') {
    update.enabled = body.enabled
  }

  if (typeof body.rollout_percent !== 'undefined') {
    const rollout = Number(body.rollout_percent)
    if (!Number.isFinite(rollout) || rollout < 0 || rollout > 100) {
      return NextResponse.json({ error: 'rollout_percent must be between 0 and 100.' }, { status: 400 })
    }
    update.rollout_percent = Math.round(rollout)
  }

  if (typeof body.description === 'string') {
    update.description = body.description.trim() || null
  }

  if (typeof body.target_roles !== 'undefined') {
    update.target_roles = parseStringArray(body.target_roles)
  }

  if (typeof body.allowed_user_ids !== 'undefined') {
    update.allowed_user_ids = parseStringArray(body.allowed_user_ids)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const adminClient = getAdminClient()
  const { data, error } = await adminClient
    .from('feature_flags')
    .update(update)
    .eq('key', key)
    .select('key, description, enabled, rollout_percent, target_roles, allowed_user_ids, updated_at')
    .single()

  if (error) {
    const message = error.message || ''
    if (message.includes('relation') && message.includes('feature_flags')) {
      return NextResponse.json({ error: 'feature_flags table is not available. Run supabase/002_observability.sql first.' }, { status: 503 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json(data)
}
