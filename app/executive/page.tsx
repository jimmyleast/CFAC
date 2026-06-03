'use client'

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'

type DashboardData = {
  generatedAt: string
  weekStart: string
  dataSources: {
    hubspot: { mode: string; writesAllowed: boolean; note: string }
    supabase: { environmentRef: string | null }
    sourcePlan?: { asOf: string; files: string[] }
  }
  ceo: {
    sourceDate: string
    forecast: {
      period: string
      revenue: number
      opex: number
      noi: number
      fullYearRevenue: number
      fullYearOpex: number
      fullYearNoi: number
      marketingSpend: number
      opexRatio: number
    }
    cash: {
      period: string
      startingCash: number
      cashIn: number
      cashOut: number
      netBurn: number
      lowPointDate: string
      lowPointCash: number
      endingDate: string
      endingCash: number
    }
    capex: {
      techYearOne: number
      techPhysicalInfrastructure: number
      network: number
      avSecurity: number
      accessControl: number
      groundsKnownNeeds: number
      groundsApprovedTopNeeds: number
      healthPerformanceEquipment: number
      combinedKnownAsk: number
    }
    opex: {
      yearTwoTechRunRate: number
      recurringSaasBridge: number
      cloudAiAnnual: number
      payrollForecast: number
      marketingAdmissionsExpense: number
    }
    monthly: Array<{ month: string; revenue: number; opex: number; noi: number }>
    investmentPriorities: Array<{ name: string; amount: number; category: string; status: string; note: string }>
  }
  admissions: {
    totalApplications: number
    totalProspects: number
    activePipeline: number
    applicationsThisWeek: number
    stages: Record<string, number>
    latestSync: { completed_at?: string; records_pulled?: number; records_updated?: number; status?: string } | null
  }
  enrollment: { total: number; programs: Record<string, number> }
  intake: { total: number; complete: number; pending: number; completionRate: number }
  operations: {
    workOrders: { total: number; open: number; resolved: number }
    shifts: { total: number; scheduled: number; completed: number; clockEvents: number }
    facilities: { cabinMaintenance: number; shoppingLists: number }
  }
  finance: {
    dealPayments: number
    paymentTotal: number
    tuitionPipelineTotal: number
    ledgerPaymentTotal: number
    pendingFundsCount: number
    confirmedFundingCount: number
    source: string
    status: string
  }
  spend: {
    workOrders: { estimated: number; actual: number; records: number; source: string }
    supplies: { estimated: number; actual: number; records: number; source: string }
    capex: { projects: number; budget: number; actual: number; source: string }
    recurringOpex: { activeRecords: number; monthlyRunRate: number; source: string }
    budgetVsActual: { records: number; budget: number; actual: number; variance: number; source: string }
  }
  gaps: Array<{ area: string; status: string; source: string | null; missing: string[] }>
}

const STAGE_LABELS: Record<string, string> = {
  prospect: 'Prospect',
  applied: 'Applied',
  documents_pending: 'Docs Pending',
  eligible: 'Eligible',
  enrolled: 'Enrolled',
  withdrawn: 'Withdrawn',
}

function number(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0)
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0)
}

function compactMoney(value: number) {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value || 0)
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(abs >= 10000000 ? 1 : 2)}M`
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`
  return `${sign}$${Math.round(abs)}`
}

function signedMoney(value: number) {
  return value < 0 ? `(${compactMoney(Math.abs(value))})` : compactMoney(value)
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function pct(value: number, total: number) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

export default function ExecutiveDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/executive/dashboard')
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/auth/login')
          return null
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Dashboard failed (${res.status})`)
        return res.json()
      })
      .then((payload) => {
        if (!active || !payload) return
        setData(payload)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [router])

  const stageTotal = useMemo(() => {
    if (!data) return 0
    return Object.values(data.admissions.stages).reduce((sum, value) => sum + value, 0)
  }, [data])

  if (loading) {
    return (
      <div className="page-shell" style={{ paddingBottom: 48 }}>
        <style>{`@keyframes eShim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } } .e-skel { background: linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%); background-size: 200% 100%; animation: eShim 1.4s ease-in-out infinite; display: block; }`}</style>
        <div style={{ marginBottom: 28 }}>
          <span className="e-skel" style={{ height: 11, width: 80, marginBottom: 10 }} />
          <span className="e-skel" style={{ height: 32, width: 360, marginBottom: 8 }} />
          <span className="e-skel" style={{ height: 13, width: '70%' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
          <span className="e-skel" style={{ height: 280 }} />
          <span className="e-skel" style={{ height: 280 }} />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="page-shell" style={{ padding: 32 }}>
        <div className="surface-card" style={{ padding: 20, borderColor: '#8F2D2D' }}>
          <div style={{ fontWeight: 700, color: '#EF4444', marginBottom: 6 }}>Executive dashboard unavailable</div>
          <div style={{ color: 'var(--text-secondary)' }}>{error || 'No dashboard data returned.'}</div>
        </div>
      </div>
    )
  }

  const lastSync = data.admissions.latestSync?.completed_at
    ? new Date(data.admissions.latestSync.completed_at).toLocaleString()
    : 'No completed sync found'
  const monthlyMax = Math.max(...data.ceo.monthly.flatMap((row) => [row.revenue, row.opex]))

  return (
    <div className="page-shell" style={{ paddingBottom: 48 }}>
      {/* Canonical header */}
      <div style={{
        marginBottom: 28, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 560px', minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: '#C9A84C', marginBottom: 8,
          }}>Executive</div>
          <h1 style={{
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36,
            letterSpacing: '0.02em', textTransform: 'uppercase',
            marginBottom: 6, color: '#F0EDE6',
          }}>CEO Operating Dashboard</h1>
          <p style={{ fontSize: 13, color: '#8A8680', maxWidth: 820, lineHeight: 1.5 }}>
            Revenue, OpEx, CapEx, and cash pressure in one view for Matt E. Live UHP operating data is blended with the May 29 finance model, tech transformation plan, and consolidated grounds equipment needs.
          </p>
        </div>
        <div style={guardrailBadge}>
          <span style={{ color: '#7DD3C7', fontWeight: 700 }}>CEO source pack</span>
          <span style={{ color: '#A8A29A' }}>As of {data.dataSources.sourcePlan?.asOf || data.ceo.sourceDate}. HubSpot remains read-only.</span>
        </div>
      </div>

      <section style={heroGrid}>
        <div style={heroPanel}>
          <div style={{ ...eyebrow, color: '#7DD3C7' }}>Matt E lens</div>
          <div style={heroTitle}>Cash is the constraint; CapEx needs a sequenced decision.</div>
          <p style={heroCopy}>
            The May-Dec operating forecast is positive on paper, but the weekly cash model still bottoms at {signedMoney(data.ceo.cash.lowPointCash)} on {shortDate(data.ceo.cash.lowPointDate)}.
            Known CapEx asks now total {compactMoney(data.ceo.capex.combinedKnownAsk)} across technology, physical infrastructure, and grounds equipment.
          </p>
          <div style={heroStats}>
            <HeroStat label="May-Dec revenue" value={compactMoney(data.ceo.forecast.revenue)} detail="Forecasted operating revenue from the May 26 reforecast model for May through December 2026." />
            <HeroStat label="May-Dec OpEx" value={compactMoney(data.ceo.forecast.opex)} detail="Forecasted operating expenses from the May 26 reforecast model for May through December 2026." />
            <HeroStat label="May-Dec NOI" value={signedMoney(data.ceo.forecast.noi)} tone={data.ceo.forecast.noi >= 0 ? 'good' : 'warn'} detail="Net operating income for May through December 2026: revenue minus operating expenses." />
            <HeroStat label="Cash low point" value={signedMoney(data.ceo.cash.lowPointCash)} tone="warn" detail={`Lowest projected weekly cash balance in the May 29 cash flow model, occurring on ${shortDate(data.ceo.cash.lowPointDate)}.`} />
          </div>
        </div>
        <div style={decisionPanel}>
          <div style={eyebrow}>Decision stack</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {data.ceo.investmentPriorities.slice(0, 3).map((item) => (
              <div key={item.name} style={decisionRow}>
                <div>
                  <div style={{ fontWeight: 800 }}>{item.name}</div>
                  <div style={{ color: '#A8A29A', fontSize: 12, marginTop: 3 }}>{item.status} · {item.category}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 22 }}>{compactMoney(item.amount)}</strong>
                  <InfoTip label={item.name} detail={item.note} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={grid4}>
        <MetricCard label="Active Pipeline" value={number(data.admissions.activePipeline)} sub={`${number(data.admissions.applicationsThisWeek)} applications this week`} detail="Applications in active admissions stages: prospect, applied, documents pending, and eligible." />
        <MetricCard label="Enrolled Students" value={number(data.enrollment.total)} sub="SIS enrollment records" detail="Current count of SIS enrollment records by program." />
        <MetricCard label="Intake Complete" value={`${data.intake.completionRate}%`} sub={`${number(data.intake.complete)} complete, ${number(data.intake.pending)} pending`} detail="Completed intake records divided by all intake records in the app." />
        <MetricCard label="Open Work Orders" value={number(data.operations.workOrders.open)} sub={`${number(data.operations.workOrders.total)} total tracked`} tone={data.operations.workOrders.open > 0 ? 'warn' : 'good'} detail="Campus work orders currently marked open." />
      </section>

      <section style={twoCol}>
        <Panel title="Revenue, OpEx, NOI" meta={data.ceo.forecast.period}>
          <div style={{ display: 'grid', gap: 12 }}>
            {data.ceo.monthly.map((row) => (
              <div key={row.month} style={monthRow}>
                <span style={{ ...labelText, width: 34 }}>{row.month}</span>
                <div style={monthBars}>
                  <div style={{ ...monthBar, width: `${Math.max(4, (row.revenue / monthlyMax) * 100)}%`, background: '#5EEAD4' }} />
                  <div style={{ ...monthBar, width: `${Math.max(4, (row.opex / monthlyMax) * 100)}%`, background: '#F2B84B' }} />
                </div>
                <span style={{ ...valueText, width: 72, color: row.noi < 0 ? '#F2B84B' : '#D7D3CC', textAlign: 'right' }}>{signedMoney(row.noi)}</span>
              </div>
            ))}
            <div style={legendRow}>
              <span><i style={{ ...legendSwatch, background: '#5EEAD4' }} /> Revenue {compactMoney(data.ceo.forecast.revenue)}</span>
              <span><i style={{ ...legendSwatch, background: '#F2B84B' }} /> OpEx {compactMoney(data.ceo.forecast.opex)}</span>
              <span>NOI {signedMoney(data.ceo.forecast.noi)}</span>
            </div>
          </div>
        </Panel>

        <Panel title="Cash Pressure" meta={data.ceo.cash.period}>
          <div style={cashPanel}>
            <MiniStat label="Cash in" value={compactMoney(data.ceo.cash.cashIn)} detail="Total projected cash receipts from May 29 through December 30, 2026." />
            <MiniStat label="Cash out" value={compactMoney(data.ceo.cash.cashOut)} detail="Total projected cash disbursements from May 29 through December 30, 2026." />
            <MiniStat label="Net burn" value={signedMoney(data.ceo.cash.netBurn)} detail="Cash in minus cash out for the May 29 through December 30 model period." />
            <MiniStat label={`Ending ${shortDate(data.ceo.cash.endingDate)}`} value={signedMoney(data.ceo.cash.endingCash)} detail="Projected ending weekly cash position on the final date shown in the cash model." />
          </div>
          <div style={cashWarning}>
            <strong>{shortDate(data.ceo.cash.lowPointDate)} low point:</strong> {signedMoney(data.ceo.cash.lowPointCash)}. This is the financing/timing risk to resolve before approving every CapEx item at once.
          </div>
        </Panel>
      </section>

      <section style={twoCol}>
        <Panel title="Admissions Pipeline" meta={`Last HubSpot pull: ${lastSync}`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {Object.entries(data.admissions.stages).map(([stage, value]) => {
              const width = pct(value, stageTotal)
              return (
                <div key={stage}>
                  <div style={rowBetween}>
                    <span style={labelText}>{STAGE_LABELS[stage] || stage}</span>
                    <span style={valueText}>{number(value)}</span>
                  </div>
                  <div style={barTrack}>
                    <div style={{ ...barFill, width: `${Math.max(2, width)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Enrollment Mix" meta={`${number(data.enrollment.total)} current enrollments`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {Object.entries(data.enrollment.programs)
              .filter(([, value]) => value > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([program, value]) => (
                <div key={program} style={programRow}>
                  <span style={{ fontWeight: 700 }}>{program}</span>
                  <span style={{ color: '#D7D3CC' }}>{number(value)}</span>
                </div>
              ))}
          </div>
        </Panel>
      </section>

      <section style={twoCol}>
        <Panel title="Operations" meta="Existing campus operating data">
          <div style={miniGrid}>
            <MiniStat label="Resolved work orders" value={number(data.operations.workOrders.resolved)} detail="Work orders marked resolved in the campus work order table." />
            <MiniStat label="Scheduled shifts" value={number(data.operations.shifts.scheduled)} detail="Staff shifts currently in scheduled status." />
            <MiniStat label="Completed shifts" value={number(data.operations.shifts.completed)} detail="Staff shifts marked completed." />
            <MiniStat label="Clock events" value={number(data.operations.shifts.clockEvents)} detail="Clock-in and clock-out events recorded by the app." />
            <MiniStat label="Cabin maintenance rows" value={number(data.operations.facilities.cabinMaintenance)} detail="Rows in the cabin maintenance table. This is an activity count, not a dollar figure." />
            <MiniStat label="Shopping lists" value={number(data.operations.facilities.shoppingLists)} detail="Shopping list records currently tracked in the app." />
          </div>
        </Panel>

        <Panel title="Finance Signal" meta="Partial data only">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={financeHero}>
              <span style={eyebrow}>Deal payments</span>
              <strong style={{ fontSize: 34, lineHeight: 1 }}>{money(data.finance.paymentTotal)}</strong>
              <span style={{ color: '#A8A29A', fontSize: 13 }}>{number(data.finance.dealPayments)} payment records in `deal_payments`</span>
            </div>
            <div style={miniGrid}>
              <MiniStat label="Tuition pipeline" value={money(data.finance.tuitionPipelineTotal)} detail="Sum of tuition amount fields captured on application records. Treat as pipeline, not cash received." />
              <MiniStat label="Ledger payment fields" value={money(data.finance.ledgerPaymentTotal)} detail="Sum of ledger payment amount fields captured on application records." />
              <MiniStat label="Pending funds" value={number(data.finance.pendingFundsCount)} detail="Application records whose pending funds status includes pending." />
              <MiniStat label="Confirmed funding" value={number(data.finance.confirmedFundingCount)} detail="Application records marked true, yes, confirmed, complete, or completed in the funding confirmation field." />
            </div>
            <div style={notice}>
              HubSpot finance fields are pulled into Supabase for reporting only. HubSpot remains read-only from this app.
            </div>
          </div>
        </Panel>
      </section>

      <section style={twoCol}>
        <Panel title="CapEx Ask" meta="Tech + grounds source pack">
          <div style={capexStack}>
            <CapexLine label="Technology Year 1" value={data.ceo.capex.techYearOne} accent="#5EEAD4" detail="Total Year 1 investment from the technology transformation deck. Includes engineering, platform builds, physical infrastructure, cloud and AI APIs, and temporary SaaS bridge tools." />
            <CapexLine label="Grounds known needs" value={data.ceo.capex.groundsKnownNeeds} accent="#F2B84B" detail="Total priced grounds equipment needs from the consolidated grounds crew equipment document." />
            <CapexLine label="Health + performance equipment" value={data.ceo.capex.healthPerformanceEquipment} accent="#A78BFA" detail="Equipment New CAPEX row from the Health and Performance tab in the May 26 reforecast model." />
          </div>
          <div style={miniGrid}>
            <MiniStat label="Network" value={compactMoney(data.ceo.capex.network)} detail="Physical network scope from the tech deck: WiFi, cabling, fiber, switching, and campus connectivity." />
            <MiniStat label="AV + security" value={compactMoney(data.ceo.capex.avSecurity)} detail="Physical AV plus security scope from the tech deck, including Mess Hall AV, outdoor audio, and access control." />
            <MiniStat label="Access control" value={compactMoney(data.ceo.capex.accessControl)} detail="Access control estimate for 33 buildings and 66 doors at roughly $3K per door." />
            <MiniStat label="Grounds top/go" value={compactMoney(data.ceo.capex.groundsApprovedTopNeeds)} detail="Priced grounds equipment items marked Top priority and Go or Used in the consolidated grounds document." />
          </div>
        </Panel>

        <Panel title="OpEx Control" meta="Run-rate and spend levers">
          <div style={miniGrid}>
            <MiniStat label="Full-year OpEx" value={compactMoney(data.ceo.forecast.fullYearOpex)} detail="Total Expenses row from the 2026 reforecast dashboard, January through December." />
            <MiniStat label="Payroll forecast" value={compactMoney(data.ceo.opex.payrollForecast)} detail="Total 30400 Payroll Expenses row from the 2026 reforecast model." />
            <MiniStat label="Marketing spend" value={compactMoney(data.ceo.forecast.marketingSpend)} detail="Marketing Spend row from the 2026 reforecast model." />
            <MiniStat label="Year 2 tech run rate" value={compactMoney(data.ceo.opex.yearTwoTechRunRate)} detail="Projected Year 2 technology run rate after one-time builds and physical infrastructure CapEx fall away." />
          </div>
          <div style={notice}>
            OpEx is {Math.round(data.ceo.forecast.opexRatio * 100)}% of May-Dec revenue. The CEO decision is not just spend approval; it is timing against the cash trough.
          </div>
        </Panel>
      </section>

      <Panel title="Data Gaps To Close" meta="Do not mock these as real metrics">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {data.gaps.map((gap) => (
            <div key={gap.area} style={gapCard}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{gap.area}</div>
              <div style={{ color: '#A8A29A', fontSize: 12, marginBottom: 10 }}>
                {gap.source ? `Source: ${gap.source}` : 'Source needed'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {gap.missing.map((item) => (
                  <span key={item} style={pill}>{item}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function MetricCard({ label, value, sub, tone, detail }: { label: string; value: string; sub: string; tone?: 'good' | 'warn'; detail?: string }) {
  const color = tone === 'good' ? '#7DD3C7' : tone === 'warn' ? '#F2B84B' : '#FFFFFF'
  return (
    <div className="surface-card" style={{ padding: 18 }}>
      <MetricLabel label={label} detail={detail} />
      <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 42, fontWeight: 800, lineHeight: 1, color, marginTop: 8 }}>{value}</div>
      <div style={{ color: '#A8A29A', fontSize: 12, marginTop: 8 }}>{sub}</div>
    </div>
  )
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="surface-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 20, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{title}</h2>
        {meta && <span style={{ color: '#8A8680', fontSize: 12, textAlign: 'right' }}>{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={miniStat}>
      <MetricLabel label={label} detail={detail} />
      <strong style={{ fontSize: 24 }}>{value}</strong>
    </div>
  )
}

function HeroStat({ label, value, tone, detail }: { label: string; value: string; tone?: 'good' | 'warn'; detail?: string }) {
  const color = tone === 'good' ? '#7DD3C7' : tone === 'warn' ? '#F2B84B' : '#FFFFFF'
  return (
    <div style={heroStat}>
      <MetricLabel label={label} detail={detail} />
      <strong style={{ color, fontSize: 28, lineHeight: 1 }}>{value}</strong>
    </div>
  )
}

function CapexLine({ label, value, accent, detail }: { label: string; value: number; accent: string; detail?: string }) {
  return (
    <div style={capexLine}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800 }}>
          {label}
          {detail && <InfoTip label={label} detail={detail} />}
        </span>
        <span style={{ color: '#D7D3CC' }}>{compactMoney(value)}</span>
      </div>
      <div style={barTrack}>
        <div style={{ ...barFill, background: accent, width: `${Math.min(100, Math.max(4, (value / 1330000) * 100))}%` }} />
      </div>
    </div>
  )
}

function MetricLabel({ label, detail }: { label: string; detail?: string }) {
  return (
    <span style={metricLabel}>
      <span style={eyebrow}>{label}</span>
      {detail && <InfoTip label={label} detail={detail} />}
    </span>
  )
}

function InfoTip({ label, detail }: { label: string; detail: string }) {
  return (
    <details style={infoWrap}>
      <summary aria-label={`What ${label} means`} title={detail} style={infoButton}>i</summary>
      <span role="tooltip" style={infoBubble}>{detail}</span>
    </details>
  )
}

const eyebrow: React.CSSProperties = {
  color: '#8A8680',
  fontFamily: 'var(--font-condensed)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const metricLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

const infoWrap: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  zIndex: 20,
}

const infoButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 17,
  height: 17,
  listStyle: 'none',
  cursor: 'help',
  border: '1px solid rgba(125,211,199,0.45)',
  background: 'rgba(125,211,199,0.1)',
  color: '#7DD3C7',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1,
}

const infoBubble: React.CSSProperties = {
  position: 'absolute',
  top: 22,
  left: 0,
  width: 280,
  maxWidth: 'min(280px, calc(100vw - 48px))',
  padding: 12,
  background: '#1A1815',
  color: '#E8E0D3',
  border: '1px solid rgba(125,211,199,0.32)',
  boxShadow: '0 14px 30px rgba(0,0,0,0.38)',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: 0,
  lineHeight: 1.45,
  textTransform: 'none',
}

const grid4: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 16,
}

const heroGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 0.8fr)',
  gap: 16,
  marginBottom: 16,
}

const heroPanel: React.CSSProperties = {
  padding: 24,
  background: 'linear-gradient(135deg, rgba(16,42,38,0.96), rgba(18,18,18,0.98) 52%, rgba(58,43,20,0.88))',
  border: '1px solid rgba(125,211,199,0.24)',
}

const heroTitle: React.CSSProperties = {
  maxWidth: 820,
  marginTop: 10,
  fontFamily: 'var(--font-condensed)',
  fontSize: 40,
  lineHeight: 1,
  fontWeight: 900,
  textTransform: 'uppercase',
}

const heroCopy: React.CSSProperties = {
  maxWidth: 820,
  margin: '14px 0 0',
  color: '#D7D3CC',
  fontSize: 15,
  lineHeight: 1.55,
}

const heroStats: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
  marginTop: 18,
}

const heroStat: React.CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: 14,
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.1)',
}

const decisionPanel: React.CSSProperties = {
  padding: 20,
  background: '#121212',
  border: '1px solid #2B2925',
}

const decisionRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  padding: '12px 0',
  borderTop: '1px solid #24211E',
}

const twoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
  marginBottom: 16,
}

const rowBetween: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 5,
}

const labelText: React.CSSProperties = { color: '#D7D3CC', fontSize: 13 }
const valueText: React.CSSProperties = { color: '#FFFFFF', fontWeight: 700, fontSize: 13 }
const barTrack: React.CSSProperties = { height: 8, background: '#24211E', borderRadius: 0, overflow: 'hidden' }
const barFill: React.CSSProperties = { height: '100%', background: '#1AAFA0' }

const programRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 12px',
  background: '#121212',
  border: '1px solid #24211E',
}

const miniGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
}

const monthRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px minmax(120px, 1fr) 72px',
  gap: 10,
  alignItems: 'center',
}

const monthBars: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const monthBar: React.CSSProperties = {
  height: 7,
}

const legendRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  color: '#A8A29A',
  fontSize: 12,
}

const legendSwatch: React.CSSProperties = {
  display: 'inline-block',
  width: 9,
  height: 9,
  marginRight: 5,
}

const cashPanel: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
  gap: 10,
  marginBottom: 12,
}

const cashWarning: React.CSSProperties = {
  padding: 14,
  background: 'rgba(242,184,75,0.1)',
  border: '1px solid rgba(242,184,75,0.28)',
  color: '#E8E0D3',
  fontSize: 13,
  lineHeight: 1.5,
}

const capexStack: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  marginBottom: 14,
}

const capexLine: React.CSSProperties = {
  display: 'grid',
  gap: 8,
}

const miniStat: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 14,
  background: '#121212',
  border: '1px solid #24211E',
}

const financeHero: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 16,
  background: '#121212',
  border: '1px solid #24211E',
}

const notice: React.CSSProperties = {
  padding: 12,
  color: '#D7D3CC',
  background: 'rgba(242,184,75,0.08)',
  border: '1px solid rgba(242,184,75,0.24)',
  fontSize: 13,
  lineHeight: 1.5,
}

const guardrailBadge: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 260,
  padding: '12px 14px',
  background: 'rgba(26,175,160,0.08)',
  border: '1px solid rgba(26,175,160,0.28)',
  fontSize: 12,
}

const gapCard: React.CSSProperties = {
  padding: 14,
  background: '#121212',
  border: '1px solid #24211E',
}

const pill: React.CSSProperties = {
  display: 'inline-flex',
  padding: '4px 7px',
  background: '#1C1A18',
  color: '#A8A29A',
  border: '1px solid #2B2925',
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
