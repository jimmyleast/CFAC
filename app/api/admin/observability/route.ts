import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

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
      exportsCompleted: 0,
      processesCreated: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      errorRatePct: 0,
    },
    funnel: {
      processCreated: 0,
      hopeStarted: 0,
      exportCompleted: 0,
    },
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
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
        emptyPayload(days, since, 'degraded', 'Telemetry tables are not initialized. Run supabase/002_observability.sql.'),
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
  const exportsCompleted = events.filter((e) => e.event_name === 'export.completed')
  const processesCreated = events.filter((e) => e.event_name === 'process.created')

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

  const processState = new Map<string, { created: boolean; hope: boolean; exported: boolean }>()
  for (const event of events) {
    if (!event.process_id) continue
    const current = processState.get(event.process_id) || { created: false, hope: false, exported: false }
    if (event.event_name === 'process.created') current.created = true
    if (event.event_name === 'hope.chat.request') current.hope = true
    if (event.event_name === 'export.completed') current.exported = true
    processState.set(event.process_id, current)
  }

  let funnelCreated = 0
  let funnelHope = 0
  let funnelExport = 0
  for (const state of processState.values()) {
    if (state.created) funnelCreated += 1
    if (state.created && state.hope) funnelHope += 1
    if (state.created && state.hope && state.exported) funnelExport += 1
  }

  const perDay = new Map<string, { day: string; requests: number; errors: number; exports: number; created: number }>()
  for (const event of events) {
    const day = event.created_at.slice(0, 10)
    const current = perDay.get(day) || { day, requests: 0, errors: 0, exports: 0, created: 0 }
    if (event.event_name === 'hope.chat.request') current.requests += 1
    if (event.event_name === 'hope.chat.error') current.errors += 1
    if (event.event_name === 'export.completed') current.exports += 1
    if (event.event_name === 'process.created') current.created += 1
    perDay.set(day, current)
  }

  const daily = [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day))

  const errorCounts = new Map<string, number>()
  for (const event of hopeErrors) {
    const metadata = event.metadata || {}
    const errorText = typeof metadata.error === 'string' ? metadata.error : event.status || event.event_name
    const key = errorText.trim() || event.event_name
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1)
  }

  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([message, count]) => ({ message, count }))

  return NextResponse.json({
    range: { days, since },
    status: 'ok',
    note: null,
    summary: {
      totalEvents: events.length,
      hopeRequests: hopeRequests.length,
      hopeErrors: hopeErrors.length,
      exportsCompleted: exportsCompleted.length,
      processesCreated: processesCreated.length,
      avgLatencyMs,
      p95LatencyMs,
      errorRatePct,
    },
    funnel: {
      processCreated: funnelCreated,
      hopeStarted: funnelHope,
      exportCompleted: funnelExport,
    },
    daily,
    topErrors,
    recent: events.slice(0, 50),
  })
}
