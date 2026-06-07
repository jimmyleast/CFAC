// Fire-and-forget: hand a question to the global Hope dock from anywhere
// (a dashboard tile, a metric drill-down, a "build me a report" button).
// HopeDock listens for this event, opens, and asks.
// NOTE: the query string reaches an LLM — it must contain only aggregate/label
// text (a metric name, a period), never a case-level/PHI field.
export function askHope(query: string) {
  if (typeof window === 'undefined' || !query.trim()) return
  window.dispatchEvent(new CustomEvent('hope:ask', { detail: { query: query.trim() } }))
}
