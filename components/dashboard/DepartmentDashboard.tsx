'use client'

import type React from 'react'
import { useRouter } from 'next/navigation'

type Metric = {
  label: string
  value: string
  sub: string
  tone?: 'good' | 'warn' | 'bad'
}

type LinkItem = {
  label: string
  href: string
  detail: string
}

type Workstream = {
  title: string
  owner: string
  status: string
  items: string[]
}

interface DepartmentDashboardProps {
  eyebrow: string
  title: string
  copy: string
  guardrail?: string
  metrics: Metric[]
  primaryLinks: LinkItem[]
  workstreams: Workstream[]
  insights: string[]
}

export default function DepartmentDashboard({
  eyebrow,
  title,
  copy,
  guardrail,
  metrics,
  primaryLinks,
  workstreams,
  insights,
}: DepartmentDashboardProps) {
  const router = useRouter()

  return (
    <div className="page-shell" style={{ paddingBottom: 48 }}>
      <div className="page-header" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={eyebrowStyle}>{eyebrow}</div>
          <h1 className="page-title">{title}</h1>
          <p className="page-copy" style={{ maxWidth: 780 }}>{copy}</p>
        </div>
        {guardrail && <div style={guardrailStyle}>{guardrail}</div>}
      </div>

      <section style={metricGrid}>
        {metrics.map((metric) => (
          <div key={metric.label} className="surface-card" style={{ padding: 18 }}>
            <div style={metricLabelStyle}>{metric.label}</div>
            <div style={{ ...metricValue, color: toneColor(metric.tone) }}>{metric.value}</div>
            <div style={muted}>{metric.sub}</div>
          </div>
        ))}
      </section>

      <section style={twoCol}>
        <Panel title="Start Here">
          <div style={{ display: 'grid', gap: 10 }}>
            {primaryLinks.map((item) => (
              <button key={item.href + item.label} onClick={() => router.push(item.href)} style={linkButton}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <strong style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-heading)' }}>{item.label}</strong>
                  <small style={{ color: '#8A8680', fontSize: 12, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{item.detail}</small>
                </span>
                <span style={arrow}>Open</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Department Insights">
          <div style={{ display: 'grid', gap: 10 }}>
            {insights.map((insight) => (
              <div key={insight} style={insightRow}>{insight}</div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Workstreams">
        <div style={workstreamGrid}>
          {workstreams.map((stream) => (
            <div key={stream.title} style={workstreamCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <h2 style={workstreamTitle}>{stream.title}</h2>
                  <div style={muted}>Owner: {stream.owner}</div>
                </div>
                <span style={pill}>{stream.status}</span>
              </div>
              <ul style={list}>
                {stream.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card" style={{ padding: 20 }}>
      <h2 style={panelTitle}>{title}</h2>
      {children}
    </section>
  )
}

function toneColor(tone?: Metric['tone']) {
  if (tone === 'good') return '#C9A84C'
  if (tone === 'warn') return '#F2994A'
  if (tone === 'bad') return '#EB5757'
  return '#F0EDE6'
}

const eyebrowStyle: React.CSSProperties = {
  color: '#C9A84C',
  fontFamily: 'var(--font-heading)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  marginBottom: 8,
}

const metricLabelStyle: React.CSSProperties = {
  color: '#8A8680',
  fontFamily: 'var(--font-heading)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

const metricGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
  marginBottom: 18,
}

const twoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 14,
  marginBottom: 14,
}

const metricValue: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontSize: 32,
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1.1,
  marginTop: 8,
}

const muted: React.CSSProperties = { color: '#8A8680', fontSize: 12, marginTop: 6, lineHeight: 1.5 }

const guardrailStyle: React.CSSProperties = {
  maxWidth: 340,
  padding: '12px 14px',
  background: 'rgba(201,168,76,0.08)',
  border: '1px solid rgba(201,168,76,0.5)',
  color: '#D7D3CC',
  fontSize: 12,
  lineHeight: 1.5,
}

const panelTitle: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#F0EDE6',
  margin: '0 0 14px',
}

const linkButton: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: 14,
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid #2A2A2A',
  color: '#F0EDE6',
  cursor: 'pointer',
  textAlign: 'left',
}

const arrow: React.CSSProperties = {
  color: '#C9A84C',
  fontFamily: 'var(--font-heading)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

const insightRow: React.CSSProperties = {
  padding: 14,
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid #2A2A2A',
  color: '#D7D3CC',
  fontSize: 13,
  lineHeight: 1.5,
}

const workstreamGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
}

const workstreamCard: React.CSSProperties = {
  padding: 16,
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid #2A2A2A',
}

const workstreamTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-heading)',
  fontWeight: 700,
  fontSize: 16,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#F0EDE6',
}

const pill: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 8px',
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid #2A2A2A',
  color: '#8A8680',
  fontFamily: 'var(--font-heading)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}

const list: React.CSSProperties = {
  color: '#D7D3CC',
  fontSize: 13,
  lineHeight: 1.6,
  margin: 0,
  paddingLeft: 18,
}
