import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { runSync } from '@/lib/connectors/sync'
import { CONNECTORS } from '@/lib/connectors/impl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Manual "Sync all" — pulls every connected system that has a connector, in
// sequence. Admin-only; no cron (the org wants on-demand syncs for now).
export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const admin = getAdminClient()
  const { data: conns } = await admin.from('connections').select('provider').eq('status', 'connected')
  const providers = (conns || []).map((c) => c.provider).filter((p) => CONNECTORS[p])

  const now = Date.now()
  const results: { provider: string; ok: boolean; rows?: number; error?: string; skipped?: boolean; empty?: boolean }[] = []
  for (const provider of providers) {
    const r = await runSync(admin, provider, CONNECTORS, now)
    results.push({ provider, ...r })
    // Emit ONE attributable event per provider (same shape as the per-provider sync
    // route) so the observability dashboard can name a failing/empty source even when
    // the sync was triggered via "Sync all". A provider-less batch roll-up would count
    // a failure but leave on-call unable to tell WHICH source broke. A lock-skip stays
    // a benign system/skipped (never alerts); rows:0 is the distinct ok_empty signal.
    void emitAppEvent({
      eventName: 'connection.synced', category: r.ok || r.skipped ? 'system' : 'error',
      userId: gate.user.id, route: '/api/connections/sync-all',
      status: r.ok ? (r.empty ? 'ok_empty' : 'ok') : r.skipped ? 'skipped' : 'error',
      metadata: { provider, rows: r.rows ?? 0, batch: true, error: r.ok || r.skipped ? undefined : r.error },
    }).catch(() => {})
  }

  const okCount = results.filter((r) => r.ok).length
  const skippedCount = results.filter((r) => r.skipped).length
  return NextResponse.json({ ok: true, synced: okCount, skipped: skippedCount, total: results.length, results })
}
