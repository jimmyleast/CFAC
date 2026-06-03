'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type AssignedWorkItem = {
  type: 'work_order' | 'task'
  id: string
  workOrderId: string
  title: string
  priority: string
  status: string
  dueAt?: string | null
  nextAction?: string | null
  location?: string | null
  parentTitle?: string | null
}

type NotificationItem = {
  id: string
  title?: string | null
  body?: string | null
  link_href?: string | null
  read: boolean
  created_at: string
}

const GOLD = '#C9A84C'
const BG2 = 'rgba(255,255,255,0.025)'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'
const CRITICAL = '#DC2626'

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

function fmtDueShort(iso?: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return `OVERDUE ${Math.abs(diff)}D`
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'TOMORROW'
  if (diff < 7) return `${diff}D`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

function fmtAge(iso: string) {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'NOW'
  if (min < 60) return `${min}M`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}H`
  return `${Math.floor(hr / 24)}D`
}

export default function HomePage() {
  const router = useRouter()
  const [userName, setUserName] = useState<string>('')
  const [assignedWork, setAssignedWork] = useState<AssignedWorkItem[]>([])
  const [workLoading, setWorkLoading] = useState(true)
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null)
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(true)
  const [nextCohort, setNextCohort] = useState<{ date: Date; program: string } | null>(null)

  useEffect(() => {
    authFetch('/api/me').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setUserName(data?.display_name || data?.name || (data?.email || '').split('@')[0] || '')
      }
    })

    authFetch('/api/dashboard/home').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setAssignedWork(Array.isArray(data.assignedWork) ? data.assignedWork : [])
      }
      setWorkLoading(false)
    }).catch(() => setWorkLoading(false))

    authFetch('/api/approvals').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setPendingApprovals(Array.isArray(data?.approvals) ? data.approvals.length : 0)
      } else {
        setPendingApprovals(null)
      }
      setApprovalsLoading(false)
    }).catch(() => { setPendingApprovals(null); setApprovalsLoading(false) })

    authFetch('/api/notifications').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setNotifications(Array.isArray(data.notifications) ? data.notifications.slice(0, 5) : [])
      }
      setNotifLoading(false)
    }).catch(() => setNotifLoading(false))

    const supabase = createClient()
    supabase
      .from('cohorts')
      .select('start_date, program')
      .eq('status', 'upcoming')
      .gte('start_date', new Date().toISOString().split('T')[0])
      .order('start_date', { ascending: true })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.start_date) {
          // Parse as local date to avoid UTC-midnight timezone rollback
          const [y, m, d] = data.start_date.split('T')[0].split('-').map(Number)
          setNextCohort({ date: new Date(y, m - 1, d), program: data.program })
        }
      })
  }, [])

  const daysToLaunch = nextCohort
    ? Math.max(0, Math.ceil((nextCohort.date.getTime() - Date.now()) / 86400000))
    : null
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()
  const firstName = userName.split(/\s+/)[0] || ''

  const openItems = assignedWork.slice(0, 5)
  const dueNext24 = assignedWork.filter((w) => w.dueAt && new Date(w.dueAt).getTime() <= Date.now() + 86400000).length

  return (
    <div className="home-page-shell" style={{ padding: '40px 48px 64px', minHeight: '100vh', position: 'relative' }}>
      <div style={{
        fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
        letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8,
      }}>Home</div>

      <h1 style={{
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36,
        letterSpacing: '0.02em', textTransform: 'uppercase', marginBottom: 6, color: TEXT,
      }}>
        {greeting}{firstName ? `, ${firstName}` : ''}
      </h1>

      <p style={{ fontSize: 13, color: TEXT2, marginBottom: 32, maxWidth: 720 }}>
        {todayLabel}. Here&apos;s what&apos;s open. Ask Morgan if anything feels stuck.
      </p>

      {/* KPI cards */}
      <div className="home-kpi-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: 28,
      }}>
        <KpiCard
          label={nextCohort ? `Days to ${nextCohort.program} launch` : 'Next cohort'}
          value={daysToLaunch === null ? '—' : String(daysToLaunch)}
          trend={nextCohort
            ? `${nextCohort.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · firm date`
            : ''}
          loading={nextCohort === null}
        />
        <KpiCard
          label="Assigned to me"
          value={String(assignedWork.length)}
          trend={`${dueNext24} due in next 24h`}
          loading={workLoading}
        />
        <KpiCard
          label="Approvals queue"
          value={pendingApprovals === null ? '—' : String(pendingApprovals)}
          trend={pendingApprovals === null ? 'Admin only' : pendingApprovals === 0 ? 'Nothing pending' : 'Awaiting review'}
          loading={approvalsLoading}
        />
      </div>

      {/* Two-column panels */}
      <div className="home-panels-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        {/* My Open Work */}
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '18px 18px 20px' }}>
          <div style={{
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: TEXT,
          }}>
            My Open Work
            <button
              type="button"
              onClick={() => router.push('/requests/backlog')}
              style={{
                background: 'transparent', border: `1px solid ${LINE2}`, color: TEXT2,
                fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '3px 8px', cursor: 'pointer',
              }}
            >View all</button>
          </div>

          {workLoading ? (
            <RowSkeletons count={5} />
          ) : openItems.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: TEXT2, fontSize: 13 }}>
              Nothing assigned right now.
            </div>
          ) : (
            openItems.map((item) => {
              const due = fmtDueShort(item.dueAt)
              const overdue = due?.startsWith('OVERDUE')
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/work-orders/${item.workOrderId}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/work-orders/${item.workOrderId}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0', borderBottom: `1px solid ${LINE}`,
                    fontSize: 13, gap: 12, cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    {item.type === 'task'
                      ? <Icons.CheckSquare size={14} color={TEXT2} strokeWidth={1.5} />
                      : <Icons.Wrench size={14} color={TEXT2} strokeWidth={1.5} />
                    }
                    <span style={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: TEXT,
                    }}>{item.title}</span>
                  </div>
                  {due && (
                    <span style={{
                      fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                      color: overdue ? CRITICAL : TEXT2, flexShrink: 0,
                    }}>{due}</span>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Recent Activity */}
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '18px 18px 20px' }}>
          <div style={{
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14, color: TEXT,
          }}>
            Recent Activity
          </div>

          {notifLoading ? (
            <RowSkeletons count={4} />
          ) : notifications.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: TEXT2, fontSize: 13 }}>
              No recent notifications.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                role={n.link_href ? 'button' : undefined}
                tabIndex={n.link_href ? 0 : undefined}
                onClick={() => { if (n.link_href) window.location.href = n.link_href }}
                style={{
                  padding: '10px 0', borderBottom: `1px solid ${LINE}`,
                  cursor: n.link_href ? 'pointer' : 'default',
                  borderLeft: n.read ? '2px solid transparent' : `2px solid ${GOLD}`,
                  paddingLeft: 10,
                  marginLeft: -10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{
                    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12,
                    letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT,
                  }}>{n.title || 'Notification'}</span>
                  <span style={{
                    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10,
                    letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2,
                  }}>{fmtAge(n.created_at)}</span>
                </div>
                {n.body && (
                  <div style={{ fontSize: 12, color: TEXT2, marginTop: 4, lineHeight: 1.4 }}>
                    {n.body}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, trend, loading }: { label: string; value: string; trend: string; loading?: boolean }) {
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '18px 18px 20px' }}>
      <div style={{
        fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2, marginBottom: 12,
      }}>{label}</div>
      {loading ? (
        <ShimmerBlock height={34} width={72} />
      ) : (
        <div style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 34,
          letterSpacing: '0.02em', lineHeight: 1, color: TEXT,
        }}>{value}</div>
      )}
      <div style={{ fontSize: 11, marginTop: 8, color: TEXT2, minHeight: 14 }}>
        {loading ? <ShimmerBlock height={11} width={96} /> : trend}
      </div>
    </div>
  )
}

function ShimmerBlock({ height, width }: { height: number; width: number | string }) {
  return (
    <>
      <style>{`@keyframes hShim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{
        height,
        width,
        background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%)',
        backgroundSize: '200% 100%',
        animation: 'hShim 1.4s ease-in-out infinite',
      }} />
    </>
  )
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 0', borderBottom: `1px solid ${LINE}`, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <ShimmerBlock height={14} width={14} />
            <ShimmerBlock height={12} width={`${60 + (i % 3) * 12}%`} />
          </div>
          <ShimmerBlock height={11} width={48} />
        </div>
      ))}
    </>
  )
}
