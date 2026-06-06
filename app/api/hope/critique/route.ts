import { getRequestUser } from '@/lib/auth/requestUser'

export const runtime = 'nodejs'

type CritiqueScore = {
  score: number
  issues: string[]
  suggestion: string
}

type CritiqueResult = {
  openai: CritiqueScore & { available: boolean }
  gemini: CritiqueScore & { available: boolean }
}

function buildPrompt(hopeResponse: string, sopJson: string | null): string {
  return `You are a senior operations consultant peer-reviewing an AI process design assistant called Hope.

Hope's response:
${hopeResponse.slice(0, 1200)}
${sopJson ? `\nExtracted SOP JSON:\n${sopJson.slice(0, 600)}\n` : ''}
Rate this response on operational accuracy, question quality, and completeness.
Return ONLY valid JSON (no markdown):
{"score":<1-10>,"issues":[<up to 2 brief specific issues, empty array if none>],"suggestion":"<one concrete improvement or empty string if excellent>"}`
}

function parseCritiqueJson(text: string): Partial<CritiqueScore> {
  try {
    return JSON.parse(text) as Partial<CritiqueScore>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0]) as Partial<CritiqueScore>
      } catch {
        return {}
      }
    }
    return {}
  }
}

function clampScore(score: unknown): number {
  return typeof score === 'number' ? Math.max(1, Math.min(10, Math.round(score))) : 5
}

export async function POST(req: Request) {
  // Auth required — this route calls paid LLM APIs (OpenAI/Gemini) with our keys.
  const user = await getRequestUser(req)
  if (!user) return new Response('Unauthorized', { status: 401 })

  let hopeResponse: string
  let sopJson: string | null

  try {
    const body = (await req.json()) as { hopeResponse?: string; sopJson?: string | null }
    hopeResponse = body.hopeResponse ?? ''
    sopJson = body.sopJson ?? null
  } catch {
    return new Response('Invalid payload', { status: 400 })
  }

  if (!hopeResponse.trim()) {
    return Response.json({
      openai: { available: false, score: 0, issues: [], suggestion: '' },
      gemini: { available: false, score: 0, issues: [], suggestion: '' },
    })
  }

  const prompt = buildPrompt(hopeResponse, sopJson)

  const result: CritiqueResult = {
    openai: { available: false, score: 0, issues: [], suggestion: '' },
    gemini: { available: false, score: 0, issues: [], suggestion: '' },
  }

  await Promise.all([
    // OpenAI GPT-4o-mini
    (async () => {
      const key = process.env.OPENAI_API_KEY
      if (!key) return
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) throw new Error(`OpenAI responded ${res.status}`)
        const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
        const parsed = parseCritiqueJson(data.choices[0]?.message?.content ?? '{}')
        result.openai = {
          available: true,
          score: clampScore(parsed.score),
          issues: Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean).slice(0, 2) : [],
          suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
        }
      } catch (err) {
        console.error('[critique] OpenAI error:', err instanceof Error ? err.message : String(err))
      }
    })(),

    // Gemini 1.5 Flash
    (async () => {
      const key = process.env.GEMINI_API_KEY
      if (!key) return
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 300 },
            }),
            signal: AbortSignal.timeout(12000),
          }
        )
        if (!res.ok) throw new Error(`Gemini responded ${res.status}`)
        const data = (await res.json()) as {
          candidates?: Array<{ content: { parts: Array<{ text: string }> } }>
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
        const parsed = parseCritiqueJson(text)
        result.gemini = {
          available: true,
          score: clampScore(parsed.score),
          issues: Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean).slice(0, 2) : [],
          suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
        }
      } catch (err) {
        console.error('[critique] Gemini error:', err instanceof Error ? err.message : String(err))
      }
    })(),
  ])

  return Response.json(result)
}
