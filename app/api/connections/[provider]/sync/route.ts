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

// Pull fresh data from a connected system into the metrics layer (admin).
export async function POST(_req: Request, { params }: { params: { provider: string } }) {
  const gate = await requireAdmin(_req)
  if ('response' in gate) return gate.response

  // Validate the path param before it reaches the DB / audit log.
  if (!/^[a-z0-9_-]{1,40}$/.test(params.provider)) return NextResponse.json({ error: 'unknown provider' }, { status: 404 })

  const admin = getAdminClient()
  let result: { ok: boolean; rows?: number; error?: string; skipped?: boolean; empty?: boolean }
  if (params.provider === 'microsoft_sharepoint') {
    const provider = getProvider('microsoft_sharepoint')
    const { data: conn } = await admin.from('connections').select('*').eq('provider', 'microsoft_sharepoint').maybeSingle()
    if (!provider || !conn || conn.status !== 'connected') {
      result = { ok: false, error: 'not connected' }
    } else {
      try {
        const creds = await resolveCreds(admin, conn, provider, Date.now())
        if (!creds.accessToken) throw new Error('no access token stored')
        const r = await syncSharePointProfiledWorkbooks(admin, creds.accessToken, gate.user.id)
        result = { ok: r.ok, rows: r.metrics, empty: r.workbooks === 0 || r.metrics === 0, error: r.errors.map((e) => `${e.name}: ${e.error}`).join('; ') || undefined }
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : 'sharepoint sync failed' }
      }
    }
  } else {
    result = await runSync(admin, params.provider, CONNECTORS, Date.now())
  }

  // A lock-skip is a benign no-op (a concurrent run is already syncing), not a
  // failure — log it as system/skipped (neutral) so red stays reserved for real
  // sync errors, and answer 409 Conflict rather than a misleading 400.
  // rows:0 on a successful pull is `ok_empty` — distinct from `ok` so a connector
  // that authenticates but silently returns nothing is watchable on the dashboard
  // instead of looking identical to a healthy sync.
  void emitAppEvent({
    eventName: 'connection.synced', category: result.ok || result.skipped ? 'system' : 'error',
    userId: gate.user.id, route: `/api/connections/${params.provider}/sync`,
    status: result.ok ? (result.empty ? 'ok_empty' : 'ok') : result.skipped ? 'skipped' : 'error',
    metadata: { provider: params.provider, rows: result.rows ?? 0, error: result.ok || result.skipped ? undefined : result.error },
  }).catch(() => {})

  if (result.skipped) return NextResponse.json({ ok: false, skipped: true, error: result.error }, { status: 409 })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, rows: result.rows })
}
