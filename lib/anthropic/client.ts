import Anthropic from '@anthropic-ai/sdk'

export function resolveAnthropicApiKey(): string {
  const raw = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!raw) return ''

  // Handle accidental env concatenation like: "sk-ant-... RESEND_API_KEY=..."
  const extracted = raw.match(/sk-ant-[^\s"']+/)?.[0]
  if (extracted) return extracted

  return raw.split(/\s+/)[0] || ''
}

export function createAnthropicClient(): Anthropic {
  const apiKey = resolveAnthropicApiKey()
  if (!apiKey) {
    throw new Error('Anthropic API key is missing or invalid')
  }
  return new Anthropic({ apiKey })
}
