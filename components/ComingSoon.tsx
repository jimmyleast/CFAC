import Link from 'next/link'

export default function ComingSoon({ name }: { name: string }) {
  return (
    <div className="page-shell" style={{ maxWidth: 600 }}>
      <div style={{
        fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: '#5BA3D9', marginBottom: 8,
      }}>Coming Soon</div>
      <h1 style={{
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36,
        letterSpacing: '0.02em', textTransform: 'uppercase',
        color: '#F0EDE6', margin: 0,
      }}>
        {name}
      </h1>
      <p style={{
        color: '#8A8680', fontSize: 13, lineHeight: 1.5,
        maxWidth: 480, margin: '6px 0 32px',
      }}>
        This module is being built. Check back soon.
      </p>
      <Link href="/home" style={{
        display: 'inline-block',
        background: 'rgba(255,255,255,0.025)', border: '1px solid #2A2A2A',
        color: '#F0EDE6',
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        padding: '9px 16px', textDecoration: 'none',
      }}>← Back to Home</Link>
    </div>
  )
}
