export default function OfflinePage() {
  return (
    <main className="page-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh' }}>
      <section className="empty-state">
        <div className="empty-title">Offline</div>
        <p className="empty-copy">
          UHP OPS cannot reach the network right now. Reconnect and refresh to load live dashboard data.
        </p>
        <a className="btn btn-primary" href="/home">Try Home</a>
      </section>
    </main>
  )
}
