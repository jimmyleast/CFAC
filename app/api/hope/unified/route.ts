import { getRequestAuth } from '@/lib/auth/requestUser'
import { runHopePipeline } from '@/lib/hope/pipeline'
import { emitAppEvent, elapsedMs } from '@/lib/telemetry/events'
import type { ChatMessage } from '@/lib/hope/providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_HISTORY = 12
const MAX_CONTENT = 4000

export async function POST(req: Request) {
  const startedAt = Date.now()
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return new Response('Unauthorized', { status: 401 })
  if (mfaRequired) return new Response('mfa_required', { status: 403 })

  const body = await req.json().catch(() => ({})) as { query?: string; history?: ChatMessage[] }
  const query = String(body.query || '').trim().slice(0, MAX_CONTENT)
  if (!query) return new Response('query required', { status: 400 })
  const history: ChatMessage[] = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CONTENT) }))

  void emitAppEvent({ eventName: 'hope.chat.request', category: 'funnel', userId: user.id, route: '/api/hope/unified', status: 'started' })

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const enc = new TextEncoder()
      const send = (obj: unknown) => {
        if (closed) return
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)) } catch { closed = true }
      }
      try {
        const result = await runHopePipeline(query, history)
        for (const w of result.answer.split(/(\s+)/)) if (w) send({ token: w })
        if (result.card) send({ card: result.card })
        if (result.followups.length) send({ followups: result.followups })

        void emitAppEvent({
          eventName: 'hope.chat.response', category: 'latency', userId: user.id, route: '/api/hope/unified',
          status: result.verified ? 'verified' : (result.verdict.critic === 'none' ? 'unverified' : 'blocked'),
          durationMs: elapsedMs(startedAt),
          metadata: { verified: result.verified, critic: result.verdict.critic, score: result.verdict.score, iterations: result.iterations, staleDays: result.staleDays, hasCard: !!result.card },
        })
      } catch (err: any) {
        // Generic message to the user; raw detail only in telemetry.
        send({ token: 'I hit a problem answering that. Please try again in a moment.' })
        void emitAppEvent({
          eventName: 'hope.chat.error', category: 'error', userId: user.id, route: '/api/hope/unified',
          status: 'pipeline_failed', durationMs: elapsedMs(startedAt),
          metadata: { error: String(err?.message || err).slice(0, 500) },
        })
      } finally {
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } })
}
