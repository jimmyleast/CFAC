export function LoadingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block' }} />
      <span className="dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block' }} />
      <span className="dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block' }} />
    </div>
  )
}
