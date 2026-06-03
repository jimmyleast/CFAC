import { getAdminClient } from '@/lib/admin'

export type AppEventName =
  | 'process.created'
  | 'process.create.failed'
  | 'morgan.chat.request'
  | 'morgan.chat.response'
  | 'morgan.chat.error'
  | 'morgan.inventory.preview'
  | 'morgan.inventory.confirmed'
  | 'morgan.inventory.cancelled'
  | 'morgan.inventory.error'
  | 'morgan.schema_guard.coerced'
  | 'morgan.schema_guard.rejected'
  | 'export.requested'
  | 'export.completed'
  | 'export.failed'
  | 'admin.invite.sent'
  | 'admin.invite.failed'
  | 'admin.squad_member.added'
  | 'admin.squad_member.removed'
  | 'admin.squad_member.failed'
  | 'discovery.bridge.completed'

export type AppEventCategory = 'funnel' | 'latency' | 'error' | 'quality' | 'system'

export type AppEventInput = {
  eventName: AppEventName
  category: AppEventCategory
  userId?: string | null
  processId?: string | null
  route?: string | null
  status?: string | null
  durationMs?: number | null
  metadata?: Record<string, unknown>
}

export async function emitAppEvent(input: AppEventInput): Promise<void> {
  try {
    const adminClient = getAdminClient()
    await adminClient.from('app_events').insert({
      event_name: input.eventName,
      category: input.category,
      user_id: input.userId || null,
      process_id: input.processId || null,
      route: input.route || null,
      status: input.status || null,
      duration_ms: typeof input.durationMs === 'number' ? Math.max(0, Math.round(input.durationMs)) : null,
      metadata: input.metadata || {},
    })
  } catch (error) {
    // Telemetry should never block request paths.
    console.error('[telemetry] emitAppEvent failed:', error)
  }
}

export function elapsedMs(start: number): number {
  return Math.max(0, Date.now() - start)
}
