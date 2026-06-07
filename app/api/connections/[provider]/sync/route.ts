import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { runSync } from '@/lib/connectors/sync'
import { CONNECTORS } from '@/lib/connectors/impl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Pull fresh data from a connected system into the metrics layer (admin).
export async function POST(_req: Request, { params }: { params: { provider: string } }) {
  const gate = await requireAdmin(_req)
  if ('response' in gate) return gate.response

  // Validate the path param before it reaches the DB / audit log.
  if (!/^[a-z0-9_-]{1,40}$/.test(params.provider)) return NextResponse.json({ error: 'unknown provider' }, { status: 404 })

  const result = await runSync(getAdminClient(), params.provider, CONNECTORS, Date.now())

  // A lock-skip is a benign no-op (a concurrent run is already syncing), not a
  // failure — log it as system/skipped (neutral) so red stays reserved for real
  // sync errors, and answer 409 Conflict rather than a misleading 400.
  void emitAppEvent({
    eventName: 'connection.synced', category: result.ok || result.skipped ? 'system' : 'error',
    userId: gate.user.id, route: `/api/connections/${params.provider}/sync`,
    status: result.ok ? 'ok' : result.skipped ? 'skipped' : 'error',
    metadata: { provider: params.provider, rows: result.rows ?? 0, error: result.ok || result.skipped ? undefined : result.error },
  }).catch(() => {})

  if (result.skipped) return NextResponse.json({ ok: false, skipped: true, error: result.error }, { status: 409 })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, rows: result.rows })
}
