import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export const dynamic = 'force-dynamic'

const APPLICATION_STAGES = ['prospect', 'applied', 'documents_pending', 'eligible', 'enrolled', 'withdrawn']
const PROGRAMS = ['CPT', 'IHC', 'CNC', 'Trades', 'Patriot', 'Leadership', 'Corporate']

const CEO_SOURCE_PLAN = {
  sourceDate: '2026-05-29',
  sources: [
    'Reforecast 5-26 Working Model.xlsx',
    'UHP Cash Flow May-Dec - 5-29 working model.xlsx',
    'UHP_Tech_Transformation_Deck_v2.pptx',
    'Consolidated_Grounds_Crew_Equipment_Needs.docx',
  ],
  forecast: {
    period: 'May-Dec 2026',
    revenue: 10996716,
    opex: 10044063,
    noi: 952653,
    fullYearRevenue: 13979440,
    fullYearOpex: 13046889,
    fullYearNoi: -2068038,
    marketingSpend: 1850563,
    opexRatio: 0.9134,
  },
  cash: {
    period: 'May 29-Dec 30, 2026',
    startingCash: 139031,
    cashIn: 14227003,
    cashOut: 14494054,
    netBurn: -267052,
    lowPointDate: '2026-08-26',
    lowPointCash: -699724,
    endingDate: '2026-12-30',
    endingCash: -128021,
  },
  capex: {
    techYearOne: 1330000,
    techPhysicalInfrastructure: 395000,
    network: 154000,
    avSecurity: 241000,
    accessControl: 198000,
    groundsKnownNeeds: 341934,
    groundsApprovedTopNeeds: 217755,
    healthPerformanceEquipment: 14000,
    combinedKnownAsk: 1685934,
  },
  opex: {
    yearTwoTechRunRate: 880000,
    recurringSaasBridge: 57000,
    cloudAiAnnual: 88000,
    payrollForecast: 7657522,
    marketingAdmissionsExpense: 4984896,
  },
  monthly: [
    { month: 'May', revenue: 785214, opex: 899511, noi: -114297 },
    { month: 'Jun', revenue: 1028786, opex: 1094225, noi: -65439 },
    { month: 'Jul', revenue: 1063786, opex: 1190876, noi: -127090 },
    { month: 'Aug', revenue: 1558786, opex: 1311831, noi: 246955 },
    { month: 'Sep', revenue: 1451286, opex: 1375380, noi: 75906 },
    { month: 'Oct', revenue: 1951286, opex: 1365352, noi: 585934 },
    { month: 'Nov', revenue: 1826286, opex: 1357258, noi: 469028 },
    { month: 'Dec', revenue: 1331286, opex: 1449630, noi: -118344 },
  ],
  investmentPriorities: [
    {
      name: 'Technology transformation',
      amount: 1330000,
      category: 'CapEx + build',
      status: 'CEO decision',
      note: 'Own the operating platform, complete physical infrastructure, and exit temporary SaaS bridges.',
    },
    {
      name: 'Physical infrastructure',
      amount: 395000,
      category: 'CapEx',
      status: 'July launch critical',
      note: 'Network, AV, and access control needed before full campus launch.',
    },
    {
      name: 'Grounds equipment',
      amount: 217755,
      category: 'CapEx',
      status: 'Top/go list',
      note: 'Telehandler, utility truck, trailer, Gators, spreader, portable power, compressor, washer.',
    },
    {
      name: 'Known grounds backlog',
      amount: 341934,
      category: 'CapEx',
      status: 'Needs sequencing',
      note: '21 priced equipment needs from the consolidated grounds list; excludes unpriced autonomous mowing item.',
    },
  ],
}

type CountFilter = {
  column: string
  op: 'eq' | 'gte' | 'not'
  value: string
}

function startOfWeekIso() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

async function countRows(table: string, filters: CountFilter[] = []) {
  const admin = getAdminClient()
  let query = admin.from(table).select('*', { count: 'exact', head: true })
  for (const filter of filters) {
    if (filter.op === 'eq') query = query.eq(filter.column, filter.value)
    if (filter.op === 'gte') query = query.gte(filter.column, filter.value)
    if (filter.op === 'not') query = query.not(filter.column, 'is', filter.value)
  }
  const { count, error } = await query
  if (error) return { count: 0, error: error.message }
  return { count: count || 0, error: null }
}

async function countByValues(table: string, column: string, values: string[]) {
  const entries = await Promise.all(
    values.map(async (value) => [value, await countRows(table, [{ column, op: 'eq', value }])] as const),
  )
  return Object.fromEntries(entries.map(([value, result]) => [value, result.count]))
}

async function fetchRows(table: string, select: string, limit = 1000) {
  const admin = getAdminClient()
  const { data, error } = await admin.from(table).select(select).limit(limit)
  if (error) return { data: [], error: error.message }
  return { data: data || [], error: null }
}

function sumMoney<T extends Record<string, any>>(rows: T[], column: keyof T) {
  return rows.reduce((sum, row) => sum + Number(row[column] || 0), 0)
}

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const teamCtx = await getUserTeamContext(user.id)
  const slugs = (teamCtx.teams || []).map((team) => team.teamSlug)
  const canView = teamCtx.canSeeAll || slugs.some((slug) => ['executive', 'technology'].includes(slug))
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const weekStart = startOfWeekIso()

  const [
    applicationTotal,
    applicationStages,
    applicationsThisWeek,
    prospectsTotal,
    enrollmentTotal,
    enrollmentPrograms,
    intakeTotal,
    intakeComplete,
    workOrderTotal,
    openWorkOrders,
    resolvedWorkOrders,
    shiftsTotal,
    scheduledShifts,
    completedShifts,
    clockEvents,
    cabinMaintenance,
    shoppingLists,
    latestSyncRows,
    paymentRows,
    applicationFinanceRows,
    workOrderSpendRows,
    shoppingSpendRows,
    capitalProjectRows,
    operatingExpenseRows,
    budgetPeriodRows,
  ] = await Promise.all([
    countRows('applications'),
    countByValues('applications', 'stage', APPLICATION_STAGES),
    countRows('applications', [{ column: 'created_at', op: 'gte', value: weekStart }]),
    countRows('prospects'),
    countRows('sis_enrollments'),
    countByValues('sis_enrollments', 'program', PROGRAMS),
    countRows('student_intake'),
    countRows('student_intake', [{ column: 'completed_at', op: 'not', value: 'null' }]),
    countRows('work_orders'),
    countRows('work_orders', [{ column: 'status', op: 'eq', value: 'open' }]),
    countRows('work_orders', [{ column: 'status', op: 'eq', value: 'resolved' }]),
    countRows('shifts'),
    countRows('shifts', [{ column: 'status', op: 'eq', value: 'scheduled' }]),
    countRows('shifts', [{ column: 'status', op: 'eq', value: 'completed' }]),
    countRows('clock_events'),
    countRows('cabin_maintenance'),
    countRows('shopping_lists'),
    getAdminClient().from('sync_log').select('*').order('completed_at', { ascending: false }).limit(1),
    fetchRows('deal_payments', 'payment_amount,payment_source,payment_date', 5000),
    fetchRows(
      'applications',
      'tuition_amount,funding_source,gi_bill_benefits,gi_bill_certified,ledger_new_payment_amount,ledger_new_payment_date,ledger_new_payment_source,pending_funds_status,funding_source_confirmed,admissions_rep_funding_notes',
      5000,
    ),
    fetchRows('work_orders', 'estimated_cost,actual_cost,budget_category,completed_at', 5000),
    fetchRows('shopping_lists', 'total_estimated_cost,actual_cost,budget_category,purchased_at', 5000),
    fetchRows('capital_projects', 'budget_amount,estimated_cost,actual_cost,status,category', 5000),
    fetchRows('operating_expenses', 'amount,billing_frequency,category,active', 5000),
    fetchRows('budget_periods', 'budget_amount,actual_amount,budget_category,period_start,period_end,period_type', 5000),
  ])

  const paymentData = paymentRows.data as Array<{ payment_amount?: number | string | null; payment_source?: string | null }>
  const applicationFinanceData = applicationFinanceRows.data as Array<{
    tuition_amount?: number | string | null
    ledger_new_payment_amount?: number | string | null
    pending_funds_status?: string | null
    funding_source_confirmed?: string | null
  }>
  const workOrderSpendData = workOrderSpendRows.data as Array<{ estimated_cost?: number | string | null; actual_cost?: number | string | null }>
  const shoppingSpendData = shoppingSpendRows.data as Array<{ total_estimated_cost?: number | string | null; actual_cost?: number | string | null }>
  const capitalProjectData = capitalProjectRows.data as Array<{ budget_amount?: number | string | null; estimated_cost?: number | string | null; actual_cost?: number | string | null; status?: string | null }>
  const operatingExpenseData = operatingExpenseRows.data as Array<{ amount?: number | string | null; billing_frequency?: string | null; active?: boolean | null }>
  const budgetPeriodData = budgetPeriodRows.data as Array<{ budget_amount?: number | string | null; actual_amount?: number | string | null }>

  const paymentTotal = sumMoney(paymentData, 'payment_amount')
  const tuitionPipelineTotal = sumMoney(applicationFinanceData, 'tuition_amount')
  const ledgerPaymentTotal = sumMoney(applicationFinanceData, 'ledger_new_payment_amount')
  const pendingFundsCount = applicationFinanceData.filter((row) =>
    String(row.pending_funds_status || '').toLowerCase().includes('pending')
  ).length
  const confirmedFundingCount = applicationFinanceData.filter((row) =>
    ['true', 'yes', 'confirmed', 'complete', 'completed'].includes(String(row.funding_source_confirmed || '').toLowerCase())
  ).length
  const workOrderEstimated = sumMoney(workOrderSpendData, 'estimated_cost')
  const workOrderActual = sumMoney(workOrderSpendData, 'actual_cost')
  const shoppingEstimated = sumMoney(shoppingSpendData, 'total_estimated_cost')
  const shoppingActual = sumMoney(shoppingSpendData, 'actual_cost')
  const capexBudget = sumMoney(capitalProjectData, 'budget_amount')
  const capexActual = sumMoney(capitalProjectData, 'actual_cost')
  const activeRecurringOpex = operatingExpenseData
    .filter((row) => row.active !== false)
    .reduce((sum, row) => {
      const amount = Number(row.amount || 0)
      const frequency = String(row.billing_frequency || 'monthly')
      if (frequency === 'weekly') return sum + amount * 4.33
      if (frequency === 'quarterly') return sum + amount / 3
      if (frequency === 'annual') return sum + amount / 12
      if (frequency === 'one_time') return sum
      return sum + amount
    }, 0)
  const budgetTotal = sumMoney(budgetPeriodData, 'budget_amount')
  const actualTotal = sumMoney(budgetPeriodData, 'actual_amount')

  const admissionsActive =
    (applicationStages.prospect || 0) +
    (applicationStages.applied || 0) +
    (applicationStages.documents_pending || 0) +
    (applicationStages.eligible || 0)

  const intakeCompletionRate = intakeTotal.count > 0
    ? Math.round((intakeComplete.count / intakeTotal.count) * 100)
    : 0

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    weekStart,
    dataSources: {
      hubspot: {
        mode: 'read_only',
        writesAllowed: false,
        note: 'HubSpot is only pulled into Supabase. This dashboard reads Supabase aggregates.',
      },
      supabase: {
        environmentRef: process.env.SUPABASE_PROJECT_ID || null,
      },
      sourcePlan: {
        asOf: CEO_SOURCE_PLAN.sourceDate,
        files: CEO_SOURCE_PLAN.sources,
      },
    },
    ceo: CEO_SOURCE_PLAN,
    admissions: {
      totalApplications: applicationTotal.count,
      totalProspects: prospectsTotal.count,
      activePipeline: admissionsActive,
      applicationsThisWeek: applicationsThisWeek.count,
      stages: applicationStages,
      latestSync: latestSyncRows.data?.[0] || null,
    },
    enrollment: {
      total: enrollmentTotal.count,
      programs: enrollmentPrograms,
    },
    intake: {
      total: intakeTotal.count,
      complete: intakeComplete.count,
      pending: Math.max(0, intakeTotal.count - intakeComplete.count),
      completionRate: intakeCompletionRate,
    },
    operations: {
      workOrders: {
        total: workOrderTotal.count,
        open: openWorkOrders.count,
        resolved: resolvedWorkOrders.count,
      },
      shifts: {
        total: shiftsTotal.count,
        scheduled: scheduledShifts.count,
        completed: completedShifts.count,
        clockEvents: clockEvents.count,
      },
      facilities: {
        cabinMaintenance: cabinMaintenance.count,
        shoppingLists: shoppingLists.count,
      },
    },
    finance: {
      dealPayments: paymentData.length,
      paymentTotal,
      tuitionPipelineTotal,
      ledgerPaymentTotal,
      pendingFundsCount,
      confirmedFundingCount,
      source: 'deal_payments',
      status: paymentData.length > 0 ? 'partial' : 'source_needed',
    },
    spend: {
      workOrders: {
        estimated: workOrderEstimated,
        actual: workOrderActual,
        records: workOrderSpendData.length,
        source: 'work_orders',
      },
      supplies: {
        estimated: shoppingEstimated,
        actual: shoppingActual,
        records: shoppingSpendData.length,
        source: 'shopping_lists',
      },
      capex: {
        projects: capitalProjectData.length,
        budget: capexBudget,
        actual: capexActual,
        source: 'capital_projects',
      },
      recurringOpex: {
        activeRecords: operatingExpenseData.filter((row) => row.active !== false).length,
        monthlyRunRate: activeRecurringOpex,
        source: 'operating_expenses',
      },
      budgetVsActual: {
        records: budgetPeriodData.length,
        budget: budgetTotal,
        actual: actualTotal,
        variance: budgetTotal - actualTotal,
        source: 'budget_periods',
      },
    },
    gaps: [
      {
        area: 'Maintenance spend',
        status: 'needs_columns',
        source: 'work_orders',
        missing: ['estimated_cost', 'actual_cost', 'vendor_name', 'invoice_url', 'approved_by', 'approved_at', 'budget_category'],
      },
      {
        area: 'Food and supply spend',
        status: 'needs_columns',
        source: 'shopping_lists',
        missing: ['actual_cost', 'purchased_at', 'vendor_name', 'receipt_url', 'purchased_by', 'budget_category'],
      },
      {
        area: 'CapEx and construction',
        status: 'needs_tables',
        source: null,
        missing: ['capital_projects', 'capital_project_milestones'],
      },
      {
        area: 'Recurring OpEx',
        status: 'needs_table',
        source: null,
        missing: ['operating_expenses'],
      },
      {
        area: 'Budget vs actual ramp',
        status: 'needs_table',
        source: null,
        missing: ['budget_periods'],
      },
    ],
  })
}
