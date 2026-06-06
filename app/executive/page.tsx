'use client'

import * as Icons from 'lucide-react'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'

export default function ExecutivePage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>
        Executive
      </div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 32, color: TEXT, margin: '0 0 6px' }}>
        Executive Dashboard
      </h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.5, maxWidth: 760, marginBottom: 28 }}>
        Org pulse check across programs, services, reach, and financial health for CFAC leadership.
      </p>

      <div style={{
        border: `1px dashed ${LINE}`, borderRadius: 12, padding: '40px 24px',
        display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.02)',
      }}>
        <Icons.LayoutDashboard size={28} strokeWidth={1.5} color={TEXT2} />
        <div>
          <div style={{ color: TEXT, fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Pulse-check tiles populate once data is imported.</div>
          <div style={{ color: TEXT2, fontSize: 13, lineHeight: 1.5 }}>
            Import your spreadsheets under <strong style={{ color: GOLD }}>Data</strong>, then this view fills in
            from the metrics — clients served, residential phases, MH waitlist, reach, and financial health.
          </div>
        </div>
      </div>
    </div>
  )
}
