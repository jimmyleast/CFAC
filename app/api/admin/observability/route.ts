import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { redactPHI } from '@/lib/compliance/phi'

type AppEventRow = {
  id: string
  event_name: string
  category: string
  user_id: string | null
  process_id: string | null
  route: string | null
  status: string | null
  duration_ms: number | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function emptyPayload(days: number, since: string, status: 'ok' | 'degraded' = 'ok', note?: string) {
  return {
    range: { days, since },
    status,
    note: note || null,
    summary: {
      totalEvents: 0,
      hopeRequests: 0,
      hopeErrors: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      errorRatePct: 0,
    },
    hope: { verified: 0, unverified: 0, blocked: 0, criticNone: 0, criticError: 0, verifiedRatePct: null, publicRequests: 0, rateLimited: 0, maxStaleDays: null, alerts: [] },
    freshness: { staleSources: [] },
    daily: [],
    topErrors: [],
    recent: [],
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export async function GET(request: Request) {
  const { user, mfaRequired } = await getRequestAuth(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (mfaRequired) {
    return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  }

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.max(1, Math.min(30, Number(searchParams.get('days') || '7')))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const adminClient = getAdminClient()
  const { data, error } = await adminClient
    .from('app_events')
    .select('id, event_name, category, user_id, process_id, route, status, duration_ms, metadata, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) {
    const message = error.message || ''
    if (message.includes('relation') && message.includes('app_events')) {
      return NextResponse.json(
        emptyPayload(days, since, 'degraded', 'Telemetry table (app_events) is not initialized.'),
      )
    }
    return NextResponse.json(
      emptyPayload(days, since, 'degraded', `Observability backend unavailable: ${message || 'unknown error'}`),
    )
  }

  const events = (data || []) as AppEventRow[]

  const hopeRequests = events.filter((e) => e.event_name === 'hope.chat.request')
  const hopeErrors = events.filter((e) => e.event_name === 'hope.chat.error')
  const hopeResponses = events.filter((e) => e.event_name === 'hope.chat.response')

  const responseDurations = hopeResponses
    .map((e) => e.duration_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)

  const avgLatencyMs = responseDurations.length
    ? Math.round(responseDurations.reduce((sum, value) => sum + value, 0) / responseDurations.length)
    : 0
  const p95LatencyMs = Math.round(percentile(responseDurations, 95))

  const errorRatePct = hopeRequests.length
    ? Number(((hopeErrors.length / hopeRequests.length) * 100).toFixed(1))
    : 0

  const perDay = new Map<string, { day: string; requests: number; errors: number }>()
  for (const event of events) {
    const day = event.created_at.slice(0, 10)
    const current = perDay.get(day) || { day, requests: 0, errors: 0 }
    if (event.event_name === 'hope.chat.request') current.requests += 1
    if (event.event_name === 'hope.chat.error') current.errors += 1
    perDay.set(day, current)
  }

  const daily = [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day))

  const errorCounts = new Map<string, number>()
  for (const event of hopeErrors) {
    const metadata = event.metadata || {}
    const errorText = redactPHI(typeof metadata.error === 'string' ? metadata.error : event.status || event.event_name)
    const key = errorText.trim() || event.event_name
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1)
  }

  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([message, count]) => ({ message, count }))

  // --- Hope verification health (the safety + compliance signal) ---
  const byStatus = (s: string) => hopeResponses.filter((e) => e.status === s).length
  const byCritic = (c: string) => hopeResponses.filter((e) => (e.metadata?.critic) === c).length
  const verified = byStatus('verified')
  const unverified = byStatus('unverified')
  const blocked = byStatus('blocked')
  const criticNone = byCritic('none')
  const criticError = byCritic('error')
  const totalAnswers = verified + unverified + blocked
  const publicRequests = hopeRequests.filter((e) => e.route === '/api/hope/public').length
  const rateLimited = hopeErrors.filter((e) => (e.status || '').startsWith('rate_limited')).length

  // Worst staleness reported by any answer in range (data-freshness alarm).
  const reportedStale = hopeResponses
    .map((e) => (typeof e.metadata?.staleDays === 'number' ? (e.metadata!.staleDays as number) : null))
    .filter((v): v is number => v !== null)
  const maxStaleDays = reportedStale.length ? Math.max(...reportedStale) : null

  // --- Data freshness (which sources have gone quiet) ---
  let staleSources: { name: string; lastImported: string | null; staleDays: number | null }[] = []
  try {
    const { data: sources } = await adminClient.from('data_sources').select('name, last_imported_at')
    staleSources = (sources || [])
      .map((s: any) => {
        const days = s.last_imported_at ? Math.floor((Date.now() - new Date(s.last_imported_at).getTime()) / 86_400_000) : null
        return { name: s.name, lastImported: s.last_imported_at, staleDays: days }
      })
      .filter((s) => s.staleDays === null || s.staleDays > 30)
      .sort((a, b) => (b.staleDays ?? 1e9) - (a.staleDays ?? 1e9))
  } catch { /* non-fatal */ }

  return NextResponse.json({
    range: { days, since },
    status: 'ok',
    note: null,
    summary: {
      totalEvents: events.length,
      hopeRequests: hopeRequests.length,
      hopeErrors: hopeErrors.length,
      avgLatencyMs,
      p95LatencyMs,
      errorRatePct,
    },
    hope: {
      verified, unverified, blocked, criticNone, criticError,
      verifiedRatePct: totalAnswers ? Number(((verified / totalAnswers) * 100).toFixed(1)) : null,
      publicRequests, rateLimited, maxStaleDays,
      alerts: [
        ...(criticError > 0 ? [`Critic provider failing — ${criticError} answer(s) blocked by critic error`] : []),
        ...(criticNone > 0 ? [`No critic configured — ${criticNone} answer(s) shipped unverified`] : []),
        ...(maxStaleDays !== null && maxStaleDays > 60 ? [`Hope answered from data ${maxStaleDays}d stale`] : []),
      ],
    },
    freshness: { staleSources },
    daily,
    topErrors,
    // Recent feed: project to safe, structured fields only. Free-text (esp.
    // metadata.error, which can echo a staffer's typed question) is redacted so
    // the admin observability view never surfaces PHI.
    recent: events.slice(0, 50).map((e) => ({
      id: e.id,
      event_name: e.event_name,
      category: e.category,
      route: e.route,
      status: e.status,
      duration_ms: e.duration_ms,
      created_at: e.created_at,
      critic: e.metadata?.critic ?? null,
      verified: e.metadata?.verified ?? null,
      score: e.metadata?.score ?? null,
      staleDays: e.metadata?.staleDays ?? null,
      error: typeof e.metadata?.error === 'string' ? redactPHI(e.metadata.error as string) : null,
    })),
  })
}
