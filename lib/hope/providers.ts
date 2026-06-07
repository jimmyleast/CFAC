import { resolveAnthropicApiKey } from '@/lib/anthropic/client'
import Anthropic from '@anthropic-ai/sdk'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export const MODELS = {
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  gemini: process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest',
}

export function hasOpenAI() { return Boolean((process.env.OPENAI_API_KEY || '').trim()) }
export function hasGemini() { return Boolean((process.env.GEMINI_API_KEY || '').trim()) }

const TIMEOUT_MS = 30_000

/** Anthropic (primary generator). */
export async function generateAnthropic(system: string, messages: ChatMessage[], maxTokens = 1100): Promise<string> {
  const apiKey = resolveAnthropicApiKey()
  if (!apiKey) throw new Error('Anthropic API key missing')
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 })
  const res = await client.messages.create({
    model: MODELS.anthropic,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  const text = res.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('').trim()
  if (!text) throw new Error('Anthropic returned empty response')
  return text
}

/** OpenAI (critique / fallback). */
export async function generateOpenAI(system: string, messages: ChatMessage[], maxTokens = 700): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) throw new Error('OpenAI API key missing')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELS.openai,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('OpenAI returned empty response')
  return text
}

/** Gemini (critique / fallback). */
export async function generateGemini(system: string, userText: string, maxTokens = 700): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Gemini API key missing')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim()
  if (!text) throw new Error('Gemini returned empty response')
  return text
}
