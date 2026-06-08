import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { resolveCreds, runSync } from '@/lib/connectors/sync'
import { CONNECTORS } from '@/lib/connectors/impl'
import { getProvider } from '@/lib/connectors/providers'
import { syncSharePointProfiledWorkbooks } from '@/lib/connectors/sharepointExcel'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Manual "Sync all" — pulls every connected system that has a connector, in
// sequence. Admin-only; no cron (the org wants on-demand syncs for now).
export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const admin = getAdminClient()
  const { data: conns } = await admin.from('connections').select('provider').eq('status', 'connected')
  const providers = (conns || []).map((c) => c.provider).filter((p) => CONNECTORS[p] || p === 'microsoft_sharepoint')

  const now = Date.now()
  const results: { provider: string; ok: boolean; rows?: number; error?: string; skipped?: boolean; empty?: boolean }[] = []
  for (const provider of providers) {
    let r: { ok: boolean; rows?: number; error?: string; skipped?: boolean; empty?: boolean }
    if (provider === 'microsoft_sharepoint') {
      const p = getProvider('microsoft_sharepoint')
      const { data: conn } = await admin.from('connections').select('*').eq('provider', 'microsoft_sharepoint').maybeSingle()
      try {
        if (!p || !conn || conn.status !== 'connected') throw new Error('not connected')
        const creds = await resolveCreds(admin, conn, p, now)
        if (!creds.accessToken) throw new Error('no access token stored')
        const sp = await syncSharePointProfiledWorkbooks(admin, creds.accessToken, gate.user.id)
        r = { ok: sp.ok, rows: sp.metrics, empty: sp.workbooks === 0 || sp.metrics === 0, error: sp.errors.map((e) => `${e.name}: ${e.error}`).join('; ') || undefined }
      } catch (e) {
        r = { ok: false, error: e instanceof Error ? e.message : 'sharepoint sync failed' }
      }
    } else {
      r = await runSync(admin, provider, CONNECTORS, now)
    }
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
