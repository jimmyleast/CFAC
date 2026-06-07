import { generateGemini, generateOpenAI, hasGemini, hasOpenAI } from '@/lib/hope/providers'
import { redactPHI } from '@/lib/compliance/phi'

export type CriticSource = 'gemini' | 'openai' | 'none' | 'error'

export type Verdict = {
  pass: boolean
  score: number          // 1-10 (0 when unknown)
  issues: string[]
  critic: CriticSource
}

const PASS_THRESHOLD = 8

function buildCriticPrompt(query: string, catalog: string, answer: string): string {
  return `You are an independent fact-checker reviewing an AI assistant ("Hope") that answers staff questions for a child & family advocacy nonprofit using ONLY the data below.

DATA AVAILABLE TO HOPE:
${catalog}

USER QUESTION:
${query}

HOPE'S ANSWER:
${answer}

Check the answer strictly:
1. Every number/fact in the answer must be supported by the DATA above. Flag any figure not present in the data (fabrication).
2. The answer must not claim data exists that isn't there; saying "I don't have that data" is CORRECT, not an issue.
3. No client personally-identifying information (names, DOB, addresses) — flag if present.
4. The answer should actually address the question.

Return ONLY valid JSON, no markdown:
{"pass": <true|false>, "score": <integer 1-10>, "issues": [<short specific issues, [] if none>]}`
}

/** Parse a critic verdict. Requires an explicit boolean pass AND a numeric score —
 *  a malformed/truncated reply returns null (treated as a critic failure, never a pass). */
export function parseVerdict(raw: string): { pass: boolean; score: number; issues: string[] } | null {
  // Use the LAST balanced-looking object to avoid grabbing prose braces.
  const matches = raw.match(/\{[\s\S]*\}/)
  if (!matches) return null
  let j: any
  try { j = JSON.parse(matches[0]) } catch { return null }
  if (typeof j.pass !== 'boolean') return null
  if (typeof j.score !== 'number' || !Number.isFinite(j.score)) return null
  const score = Math.max(1, Math.min(10, Math.round(j.score)))
  const issues = Array.isArray(j.issues) ? j.issues.map(String).slice(0, 5) : []
  return { pass: j.pass, score, issues }
}

/**
 * Cross-model critique. Uses a DIFFERENT model than the generator (Gemini first,
 * then OpenAI). critic:'none' = no critic configured; critic:'error' = a critic
 * was configured but every attempt failed/was unparseable (a real outage, not
 * silently treated as a pass).
 */
export async function critique(query: string, catalog: string, answer: string): Promise<Verdict> {
  // Redact any structured PII before it reaches a non-BAA critic (OpenAI/Gemini).
  const prompt = buildCriticPrompt(redactPHI(query), redactPHI(catalog), redactPHI(answer))
  const configured = hasGemini() || hasOpenAI()
  let attempted = false

  if (hasGemini()) {
    attempted = true
    try {
      const v = parseVerdict(await generateGemini('You are a strict JSON-only fact-checker.', prompt, 500))
      if (v) return { ...v, pass: v.pass && v.score >= PASS_THRESHOLD, critic: 'gemini' }
    } catch { /* fall through to OpenAI */ }
  }
  if (hasOpenAI()) {
    attempted = true
    try {
      const v = parseVerdict(await generateOpenAI('You are a strict JSON-only fact-checker.', [{ role: 'user', content: prompt }], 500))
      if (v) return { ...v, pass: v.pass && v.score >= PASS_THRESHOLD, critic: 'openai' }
    } catch { /* fall through */ }
  }

  return {
    pass: false,
    score: 0,
    issues: configured ? ['Critic provider failed to return a verdict.'] : ['No critic model configured.'],
    critic: attempted ? 'error' : 'none',
  }
}
