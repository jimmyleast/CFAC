// Case-review routing + status logic (build-spec Phase 5). Pure + testable.
// The three MDT agendas and the rules for bucketing a case into one, plus the
// allowed status transitions for the human-in-the-loop workflow.

export type CaseStatus = 'new' | 'pending' | 'criminal' | 'closed'
export type Agenda = 'new' | 'pending' | 'criminal'

export const AGENDAS: { key: Agenda; label: string; hint: string }[] = [
  { key: 'new', label: 'New / Initial', hint: 'Intakes from the last 2 weeks' },
  { key: 'pending', label: 'Pending / Ongoing', hint: 'CPS 48-day response window' },
  { key: 'criminal', label: 'Criminal / Prosecution', hint: 'Prosecution pending' },
]

// Routing keywords that push a case to the criminal/prosecution agenda.
const CRIMINAL_KEYWORDS = ['no charges', 'warrant', 'arrested', 'charges filed', 'prosecut', 'criminal']

/** Bucket a case into one of the three agendas (or null if closed). */
export function deriveAgenda(status: CaseStatus, summary = ''): Agenda | null {
  if (status === 'closed') return null
  const s = (summary || '').toLowerCase()
  if (status === 'criminal' || CRIMINAL_KEYWORDS.some((k) => s.includes(k))) return 'criminal'
  if (status === 'pending') return 'pending'
  return 'new'
}

// Allowed status moves (human-in-the-loop; no silent automation of case decisions).
const STATUS_FLOW: Record<CaseStatus, CaseStatus[]> = {
  new: ['pending', 'criminal', 'closed'],
  pending: ['criminal', 'closed', 'new'],
  criminal: ['closed', 'pending'],
  closed: ['new'],
}

export function canMove(from: CaseStatus, to: CaseStatus): boolean {
  return (STATUS_FLOW[from] || []).includes(to)
}

export function isCaseStatus(v: unknown): v is CaseStatus {
  return v === 'new' || v === 'pending' || v === 'criminal' || v === 'closed'
}
