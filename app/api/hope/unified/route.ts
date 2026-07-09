import { getRequestAuth } from '@/lib/auth/requestUser'
import { runHopePipeline } from '@/lib/hope/pipeline'
import { emitAppEvent, elapsedMs } from '@/lib/telemetry/events'
import type { ChatMessage } from '@/lib/hope/providers'
import { extractHopeAttachmentContext } from '@/lib/hope/attachment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_HISTORY = 12
const MAX_CONTENT = 4000
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

async function parseHopeRequest(req: Request) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (!form) return { query: '', history: [] as ChatMessage[], attachment: null as File | null }
    const query = String(form.get('query') || '').trim().slice(0, MAX_CONTENT)
    return { query, history: [] as ChatMessage[], attachment: form.get('file') as File | null }
  }

  const body = await req.json().catch(() => ({})) as { query?: string; history?: ChatMessage[] }
  const query = String(body.query || '').trim().slice(0, MAX_CONTENT)
  const history: ChatMessage[] = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CONTENT) }))
  return { query, history, attachment: null as File | null }
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return new Response('Unauthorized', { status: 401 })
  if (mfaRequired) return new Response('mfa_required', { status: 403 })

  const { query, history, attachment } = await parseHopeRequest(req)
  if (!query) return new Response('query required', { status: 400 })

  let prompt = query
  if (attachment) {
    if (attachment.size > MAX_UPLOAD_BYTES) return new Response('attachment too large', { status: 413 })
    const context = await extractHopeAttachmentContext(attachment)
    const attachmentLines = [`Attached file: ${attachment.name || 'attachment'}`]
    if (context.text) attachmentLines.push(context.text)
    if (context.note) attachmentLines.push(context.note)
    prompt = [query, attachmentLines.join('\n')].filter(Boolean).join('\n\n')
  }

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
        // Live stage status so the dock shows progress instead of a dead spinner
        // during the (blocking) generate→critique→verify pipeline.
        const result = await runHopePipeline(prompt, history, undefined, (s) => send({ status: s }))
        send({ status: '' }) // clear status; the answer follows
        for (const w of result.answer.split(/(\s+)/)) if (w) send({ token: w })
        if (result.card) send({ card: result.card })
        if (result.followups.length) send({ followups: result.followups })

        void emitAppEvent({
          eventName: 'hope.chat.response', category: 'latency', userId: user.id, route: '/api/hope/unified',
          status: result.verified ? 'verified' : (result.verdict.critic === 'none' ? 'unverified' : 'blocked'),
          durationMs: elapsedMs(startedAt),
          metadata: { verified: result.verified, critic: result.verdict.critic, score: result.verdict.score, iterations: result.iterations, staleDays: result.staleDays, hasCard: !!result.card, viewRequested: result.viewRequested },
        })
        // Surface a broken view feature (query threw) instead of silently degrading to prose.
        if (result.viewError) {
          void emitAppEvent({
            eventName: 'hope.view.error', category: 'error', userId: user.id, route: '/api/hope/unified',
            status: 'view_resolve_failed', durationMs: elapsedMs(startedAt),
          })
        }
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
