function normalizeEnvValue(value: string) {
  const trimmed = value.trim()
  // Railway values are sometimes entered with literal wrapping quotes.
  // Strip one matching quote pair so SDK clients receive valid URLs/keys.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function requirePublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  // Must use literal access — Next.js only inlines NEXT_PUBLIC_* vars when the key is a static string literal.
  const raw =
    name === 'NEXT_PUBLIC_SUPABASE_URL'
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!raw) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  const value = normalizeEnvValue(raw)

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  if (name === 'NEXT_PUBLIC_SUPABASE_URL') {
    try {
      new URL(value)
    } catch {
      throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL value: ${value}`)
    }
  }

  return value
}

export function getSupabasePublicConfig() {
  return {
    url: requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: requirePublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  }
}