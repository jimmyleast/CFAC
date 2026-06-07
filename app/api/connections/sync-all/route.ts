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
  const results: { provider: string; ok: boolean; rows?: number; error?: string; skipped?: boolean }[] = []
  for (const provider of providers) {
    const r = await runSync(admin, provider, CONNECTORS, now)
    results.push({ provider, ...r })
  }

  // A skipped provider (its lock was held by a concurrent run) is a benign no-op,
  // NOT a failure — exclude it from the failure signal so a routine overlap can't
  // flip the whole batch to error/partial and desensitize on-call to real faults.
  const okCount = results.filter((r) => r.ok).length
  const skippedCount = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => !r.ok && !r.skipped)
  void emitAppEvent({
    eventName: 'connection.synced', category: failed.length ? 'error' : 'system',
    userId: gate.user.id, route: '/api/connections/sync-all', status: failed.length ? 'partial' : 'ok',
    metadata: {
      synced: okCount, skipped: skippedCount, total: results.length,
      outcomes: results.map((r) => ({ provider: r.provider, result: r.ok ? 'ok' : r.skipped ? 'skipped' : 'error' })),
    },
  }).catch(() => {})

  return NextResponse.json({ ok: true, synced: okCount, skipped: skippedCount, total: results.length, results })
}
