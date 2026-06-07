import { NextResponse } from 'next/server'
import { generateAnthropic } from '@/lib/hope/providers'
import { emitAppEvent, elapsedMs } from '@/lib/telemetry/events'
import { rateLimit } from '@/lib/hope/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUBLIC_SYSTEM = `You are Hope, the friendly public assistant for CFAC — the Children & Family Advocacy Center, a nonprofit in Benton County, Arkansas.

Mission: restore the lives of children who have experienced abuse and break the cycle of abuse.
Programs: child abuse hotline & crisis response; trauma-focused therapy & counseling (incl. therapy dog Xaya); a long-term residential program for women & children; community education & prevention (body-safety trainings); advocacy.
Hotline: 1-844-SAVE-A-CHILD. Office: 479-621-0385.

Rules:
- Only answer questions about CFAC, its programs, services, getting help, volunteering, or donating. For anything else, gently redirect.
- Be warm and trauma-informed. Keep answers short (2-4 sentences).
- If someone indicates a child is in immediate danger, tell them to call 911 or the hotline (1-844-SAVE-A-CHILD) now.
- Do NOT give legal or medical advice. Do NOT make up programs, statistics, names, or details you aren't sure of — direct them to contact CFAC instead.`

export async function POST(req: Request) {
  const startedAt = Date.now()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(ip)
  if (!rl.ok) {
    void emitAppEvent({ eventName: 'hope.chat.error', category: 'error', route: '/api/hope/public', status: `rate_limited_${rl.reason}` })
    return NextResponse.json({ message: 'You’ve sent a lot of messages quickly — please wait a moment and try again, or call us at 1-844-SAVE-A-CHILD.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({})) as { message?: string }
  const message = String(body.message || '').trim().slice(0, 1000)
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  void emitAppEvent({ eventName: 'hope.chat.request', category: 'funnel', route: '/api/hope/public', status: 'started' })

  // No client-supplied history (avoids prompt-injection via forged turns). Stateless.
  try {
    const reply = await generateAnthropic(PUBLIC_SYSTEM, [{ role: 'user', content: message }], 350)
    void emitAppEvent({ eventName: 'hope.chat.response', category: 'latency', route: '/api/hope/public', status: 'ok', durationMs: elapsedMs(startedAt) })
    return NextResponse.json({ message: reply })
  } catch (err: any) {
    void emitAppEvent({ eventName: 'hope.chat.error', category: 'error', route: '/api/hope/public', status: 'provider_failed', durationMs: elapsedMs(startedAt), metadata: { error: String(err?.message || err).slice(0, 300) } })
    return NextResponse.json({ message: 'I had trouble responding. Please call us at 1-844-SAVE-A-CHILD or 479-621-0385.' }, { status: 200 })
  }
}
