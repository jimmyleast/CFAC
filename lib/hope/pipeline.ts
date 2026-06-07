import { HOPE_SYSTEM_PROMPT } from '@/lib/anthropic/hopePrompt'
import { generateAnthropic, type ChatMessage } from '@/lib/hope/providers'
import { buildDataCatalog } from '@/lib/hope/context'
import { critique, type Verdict } from '@/lib/hope/critique'
import { redactPHI } from '@/lib/compliance/phi'
import { parseViewSpec, stripViewLine, resolveViewCard, type HopeViewCard } from '@/lib/hope/cards'
import { getAdminClient } from '@/lib/admin'

const MAX_ITERS = 2

export type HopeResult = {
  answer: string
  followups: string[]
  verified: boolean
  verdict: Verdict
  iterations: number
  staleDays: number | null
  card: HopeViewCard | null
}

const SAFE_FALLBACK =
  "I want to be accurate, and I couldn't confidently verify an answer from CFAC's data for that. " +
  "Could you rephrase or narrow it — for example, name the program or the time period you're asking about?"

function genSystem(catalog: string): string {
  return `${HOPE_SYSTEM_PROMPT}

You have CFAC's data below. Answer using ONLY this data.
- NEVER invent numbers or facts not present here. If the data doesn't cover the question, say so plainly and offer to help find it.
- When giving figures, cite the period and source (e.g., "1,427 in 2025, per the Impact sheet").
- Be concise; lead with the answer.
- If (and ONLY if) the user asks to see / show / build / chart / visualize / graph / trend / "build me a view of" some data, add ONE line before the [[FOLLOWUPS]] line, exactly:
  [[VIEW]] {"title":"<short title>","kind":"tiles","metricKeys":["<key>", ...]}
  Use kind "tiles" for current numbers across several metrics, or kind "bars" for a single metric's trend over time (then give just one metricKey). Use ONLY the bracketed [metric_key] values that appear in the data above. Never invent a key. Omit this line entirely for non-visual questions — and do not mention it.
- End your reply with exactly one line in this format: [[FOLLOWUPS]] question one || question two || question three  (2-3 short, relevant next questions). Do not reference this line anywhere else.

=== CFAC DATA (the only facts you may use) ===
${catalog}
=== END CFAC DATA ===`
}

export function splitFollowups(raw: string): { answer: string; followups: string[] } {
  const idx = raw.indexOf('[[FOLLOWUPS]]')
  if (idx < 0) return { answer: raw.trim(), followups: [] }
  const answer = raw.slice(0, idx).trim()
  const tail = raw.slice(idx + '[[FOLLOWUPS]]'.length).trim()
  const followups = tail.split('||').map((s) => s.trim()).filter(Boolean).slice(0, 3)
  return { answer, followups }
}

/**
 * Full Hope pipeline: generate (Claude) → cross-model critique → block-until-pass.
 * - verdict.pass → verified answer.
 * - critic 'none' (no critic configured) → degraded: returns the answer marked unverified.
 * - critic 'error' (configured critic failed) OR still failing after retries → BLOCK: safe fallback.
 * The generator (Anthropic) may throw; the caller maps that to a generic user message.
 */
export async function runHopePipeline(query: string, history: ChatMessage[] = [], componentSlug?: string): Promise<HopeResult> {
  const catalog = await buildDataCatalog(componentSlug)
  const system = genSystem(catalog.text)
  // Strip structured PII before anything reaches a model subprocessor — including
  // the BAA'd generator (defense-in-depth: aggregate questions never need PII).
  const safeQuery = redactPHI(query)
  const safeHistory: ChatMessage[] = history.slice(-8).map((m) => ({ role: m.role, content: redactPHI(m.content) }))
  const baseMessages: ChatMessage[] = [...safeHistory, { role: 'user', content: safeQuery }]

  let raw = await generateAnthropic(system, baseMessages)
  let { answer, followups } = splitFollowups(stripViewLine(raw))
  let verdict = await critique(safeQuery, catalog.text, answer)
  let iterations = 1

  // Only repair when the critic actually returned a verdict (gemini/openai) and it failed.
  while (!verdict.pass && (verdict.critic === 'gemini' || verdict.critic === 'openai') && iterations < MAX_ITERS) {
    const repairMessages: ChatMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: answer },
      { role: 'user', content: `A reviewer flagged issues with that answer: ${verdict.issues.join('; ') || 'unsupported claims'}. Rewrite it using ONLY the provided data, removing anything not supported. Keep the [[FOLLOWUPS]] line.` },
    ]
    raw = await generateAnthropic(system, repairMessages)
    ;({ answer, followups } = splitFollowups(stripViewLine(raw)))
    verdict = await critique(safeQuery, catalog.text, answer)
    iterations++
  }

  if (verdict.pass) {
    // Resolve an on-the-fly view ONLY for verified answers. Values come from the
    // DB (not the model), independently grounded and scoped to the catalog keys.
    let card: HopeViewCard | null = null
    const spec = parseViewSpec(raw)
    if (spec) {
      try { card = await resolveViewCard(spec, getAdminClient(), catalog.metricKeys) } catch { card = null }
    }
    return { answer, followups, verified: true, verdict, iterations, staleDays: catalog.staleDays, card }
  }
  // No critic configured at all → degraded pass (should not happen in prod, where critic keys exist).
  if (verdict.critic === 'none') return { answer, followups, verified: false, verdict, iterations, staleDays: catalog.staleDays, card: null }
  // Critic outage or failed verification after retries → block with a safe fallback.
  return { answer: SAFE_FALLBACK, followups: [], verified: false, verdict, iterations, staleDays: catalog.staleDays, card: null }
}
