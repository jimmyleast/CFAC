import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export const dynamic = 'force-dynamic'

const ACTIVE_WORK_ORDER_STATUSES = [
  'new',
  'open',
  'triaged',
  'assigned',
  'in_progress',
  'blocked',
  'waiting_on_vendor',
  'waiting_on_approval',
  'scheduled',
  'ready_for_verification',
  'monitoring',
]

const ACTIVE_TASK_STATUSES = ['open', 'in_progress', 'blocked']

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await getUserTeamContext(user.id)
  let slugs = ctx.teams.map(t => t.teamSlug)

  // If user is admin but not in any team yet, default to technology view
  if (slugs.length === 0) {
    const isAdmin = await checkIsAdmin(user.id, user.email || '')
    if (isAdmin) slugs = ['technology']
  }
  const adminClient = getAdminClient()

  const now = new Date()
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)
  const weekAgo = new Date(now.getTime() - 7 * 86400000)

  // Common queries
  const [p1Res, openRes, shiftsRes, clockRes, prospectsRes, assignedOrdersRes, assignedTasksRes] = await Promise.all([
    adminClient.from('work_orders').select('*', { count: 'exact', head: true }).eq('priority', 'P1').in('status', ACTIVE_WORK_ORDER_STATUSES),
    adminClient.from('work_orders').select('*', { count: 'exact', head: true }).in('status', ACTIVE_WORK_ORDER_STATUSES),
    adminClient.from('shifts').select('id, program, staff_id').gte('start_time', today.toISOString()).lt('start_time', tomorrow.toISOString()).neq('status', 'cancelled'),
    adminClient.from('clock_events').select('staff_id, event_type').gte('timestamp', today.toISOString()).in('event_type', ['clock_in', 'late']),
    adminClient.from('prospects').select('id, stage, created_at'),
    adminClient
      .from('work_orders')
      .select('id, title, category, priority, status, due_at, next_action, locations(name), work_area:ops_work_areas(name), facility:ops_facilities(name)')
      .eq('assigned_to', user.id)
      .in('status', ACTIVE_WORK_ORDER_STATUSES)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(8),
    adminClient
      .from('work_order_tasks')
      .select('id, work_order_id, title, status, due_at, work_order:work_orders(id, title, category, priority, status, locations(name), work_area:ops_work_areas(name), facility:ops_facilities(name))')
      .eq('assigned_to', user.id)
      .in('status', ACTIVE_TASK_STATUSES)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const p1Count = p1Res.count || 0
  const openCount = openRes.count || 0
  const todayShifts = shiftsRes.data || []
  const todayClockedIn = new Set((clockRes.data || []).map(e => e.staff_id))
  const uncovered = todayShifts.filter(s => s.staff_id && !todayClockedIn.has(s.staff_id) && new Date(now) > new Date(today.getTime() + 9 * 3600000)) // after 9am
  const allProspects = prospectsRes.data || []

  const onShiftNow = todayClockedIn.size
  const pipelineTotal = allProspects.filter(p => !['enrolled', 'withdrawn'].includes(p.stage)).length
  const enrolledTotal = allProspects.filter(p => p.stage === 'enrolled').length
  const appliedThisWeek = allProspects.filter(p => p.stage === 'applied' && new Date(p.created_at) >= weekAgo).length
  const teamsWithMembers = await adminClient.from('team_members').select('team_id').then(({ data }) => new Set((data || []).map(d => d.team_id)).size)

  // SIS student counts
  const { data: sisEnrollments } = await adminClient.from('sis_enrollments').select('program').in('status', ['enrolled', 'active'])
  const allSisEnrollments = sisEnrollments || []
  const totalStudents = allSisEnrollments.length
  const healthStudents = allSisEnrollments.filter(e => ['CPT', 'IHC', 'Patriot'].includes(e.program)).length
  const cncStudents = allSisEnrollments.filter(e => e.program === 'CNC').length
  // tradesStudents available via allSisEnrollments.filter when trades dashboard is added

  // Build team-specific dashboard data
  const primaryTeam = slugs.length > 0
    ? (slugs.includes('technology') ? 'technology' : slugs.includes('executive') ? 'executive' : slugs.includes('ops') ? 'ops' : slugs[0])
    : 'staff'

  const dashboard: Record<string, any> = {
    userName: ctx.name || ctx.email?.split('@')[0] || '',
    teams: slugs,
    primaryTeam,
    assignedWork: [
      ...(assignedOrdersRes.data || []).map((item: any) => ({
        type: 'work_order',
        id: item.id,
        workOrderId: item.id,
        title: item.title || item.category || 'Work order',
        priority: item.priority,
        status: item.status,
        dueAt: item.due_at,
        nextAction: item.next_action,
        location: item.facility?.name || item.locations?.name || item.work_area?.name || null,
      })),
      ...(assignedTasksRes.data || []).map((item: any) => ({
        type: 'task',
        id: item.id,
        workOrderId: item.work_order_id,
        title: item.title,
        priority: item.work_order?.priority || 'P3',
        status: item.status,
        dueAt: item.due_at,
        nextAction: null,
        location: item.work_order?.facility?.name || item.work_order?.locations?.name || item.work_order?.work_area?.name || null,
        parentTitle: item.work_order?.title || item.work_order?.category || 'Work order',
      })),
    ]
      .sort((a, b) => {
        const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
        return aTime - bTime
      })
      .slice(0, 8),
  }

  if (slugs.includes('ops')) {
    dashboard.ops = { p1_count: p1Count, total_open: openCount, uncovered_shifts: uncovered.length, on_shift_now: onShiftNow }
  }
  if (slugs.includes('health')) {
    const healthShifts = todayShifts.filter(s => ['CPT', 'IHC', 'Patriot'].includes(s.program))
    dashboard.health = { todays_sessions: healthShifts.length, students_count: healthStudents, students_flagged: 0 }
  }
  if (slugs.includes('culinary')) {
    const cncShifts = todayShifts.filter(s => s.program === 'CNC')
    dashboard.culinary = { todays_cnc_sessions: cncShifts.length, cnc_students: cncStudents, dietary_flags: 0, meal_requests: 0 }
  }
  if (slugs.includes('admissions')) {
    const byStage = allProspects.reduce((acc: any, p) => { acc[p.stage] = (acc[p.stage] || 0) + 1; return acc }, {})
    dashboard.admissions = { pipeline_by_stage: byStage, applications_this_week: appliedThisWeek, pipeline_total: pipelineTotal, enrolled: enrolledTotal }
  }
  if (slugs.includes('marketing')) {
    dashboard.marketing = { pipeline_total: pipelineTotal, lli_status: 'Active', walmart_status: 'In Progress' }
  }
  if (slugs.includes('executive')) {
    dashboard.executive = { p1_count: p1Count, total_open: openCount, pipeline_total: pipelineTotal, uncovered_shifts: uncovered.length, total_students: totalStudents }
  }
  if (slugs.includes('technology')) {
    dashboard.technology = { p1_count: p1Count, total_open: openCount, pipeline_total: pipelineTotal, uncovered_shifts: uncovered.length, teams_active: teamsWithMembers, total_students: totalStudents }
  }

  return NextResponse.json(dashboard)
}
