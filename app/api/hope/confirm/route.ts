import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth/requestUser'

export const dynamic = 'force-dynamic'

// Card preview→confirm endpoint. v1 Hope is read-only (answers + grounded views),
// so no card currently requires confirmation. This acknowledges safely and is the
// hook for future write-actions (which must re-validate + enforce authz here).
export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { decision } = await req.json().catch(() => ({})) as { actionId?: string; decision?: string }
  return NextResponse.json({
    response: decision === 'cancel' ? 'Cancelled.' : 'There are no write actions to confirm yet.',
  })
}
