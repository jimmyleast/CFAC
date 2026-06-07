import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { emitAppEvent } from '@/lib/telemetry/events'
import { sanitizeDefinitionPatch } from '@/lib/definitions/sanitizePatch'

export const dynamic = 'force-dynamic'

// Operational Definitions library — the enforced single source of truth for what
// every metric means. Governance metadata only (no client PII). Staff read;
// admins refine the prose/calc rule/owner so the org keeps one definition each.

export async function GET(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })

  const { data, error } = await getAdminClient()
    .from('metric_definitions')
    .select('id, key, display_name, definition, category, program_area, unit, calc_rule, accepted_values, required_fields, parent_key, owner, source_note, is_dedup_rule, sort_order, updated_at')
    .order('sort_order', { ascending: true })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ definitions: data || [] })
}

export async function PATCH(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  if (!(await checkIsAdmin(user.id, user.email || ''))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { key?: string; patch?: Record<string, unknown> }
  const key = String(body.key || '').trim()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  // Only governance prose is editable; structural fields are never writable.
  const patch: Record<string, unknown> = sanitizeDefinitionPatch(body.patch)
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'no editable fields' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const { data, error } = await getAdminClient()
    .from('metric_definitions')
    .update(patch)
    .eq('key', key)
    .select('key')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'definition not found' }, { status: 404 })

  // Governance: every definition change is traceable (build-spec §2.2 Governance).
  await emitAppEvent({
    eventName: 'definition.updated', category: 'system', userId: user.id, route: '/api/definitions',
    status: 'ok', metadata: { key, fields: Object.keys(patch).filter((k) => k !== 'updated_at') },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
