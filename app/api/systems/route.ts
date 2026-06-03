import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient, getUserSquadIds } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getAdminClient()
  const admin = await checkIsAdmin(user.id, user.email || '')

  let query = adminClient
    .from('process_systems')
    .select('*, processes(id, name, squad_id), squads(id, name, color)')
    .order('must_have_for_pilot', { ascending: false })
    .order('name', { ascending: true })

  if (!admin) {
    const squadIds = await getUserSquadIds(user.id)
    if (squadIds.length > 0) {
      query = query.or(`squad_id.in.(${squadIds.join(',')}),squad_id.is.null`)
    } else {
      query = query.is('squad_id', null)
    }
  }

  const { data: systems, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-derive status from linked request tickets for systems still marked "needed"
  // Look up system request tickets by name pattern: "[System] <name>: ..."
  const needsSync = (systems || []).filter(
    (s: any) => s.status === 'needed' || s.status === 'active'
  )
  if (needsSync.length > 0) {
    const { data: tickets } = await adminClient
      .from('uhp_requests')
      .select('title, status, builder_status')
      .eq('category', 'system')

    if (tickets && tickets.length > 0) {
      const ticketMap = new Map<string, any>()
      for (const t of tickets) {
        // Extract system name from "[System] Name: Recommendation"
        const match = t.title?.match(/^\[System\]\s*(.+?):\s*/)
        if (match) ticketMap.set(match[1].toLowerCase(), t)
      }

      for (const sys of systems || []) {
        const ticket = ticketMap.get(sys.name.toLowerCase())
        if (!ticket) continue

        // Derive status from ticket lifecycle
        let derived = sys.status
        if (ticket.status === 'done' || ticket.builder_status === 'deployed') {
          derived = 'live'
        } else if (ticket.status === 'in_progress' || ticket.builder_status === 'pending') {
          derived = 'in_progress'
        } else if (ticket.status === 'rejected') {
          derived = 'deferred'
        } else if (ticket.status === 'scored' || ticket.status === 'new') {
          derived = 'not_started'
        }

        // Only override if user hasn't manually set it (check updated_at vs created_at)
        if (derived !== sys.status) {
          sys.derived_status = derived
        }
      }
    }
  }

  return NextResponse.json(systems)
}
