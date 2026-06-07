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
  const results: { provider: string; ok: boolean; rows?: number; error?: string }[] = []
  for (const provider of providers) {
    const r = await runSync(admin, provider, CONNECTORS, now)
    results.push({ provider, ...r })
  }

  const okCount = results.filter((r) => r.ok).length
  void emitAppEvent({
    eventName: 'connection.synced', category: results.every((r) => r.ok) ? 'system' : 'error',
    userId: gate.user.id, route: '/api/connections/sync-all', status: okCount === results.length ? 'ok' : 'partial',
    metadata: { synced: okCount, total: results.length },
  }).catch(() => {})

  return NextResponse.json({ ok: true, synced: okCount, total: results.length, results })
}
