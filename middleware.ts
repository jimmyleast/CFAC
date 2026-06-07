import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabasePublicConfig } from '@/lib/supabase/config'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  // If the public Supabase config is missing/invalid, don't 500 every route —
  // skip the auth-cookie refresh and let the request through. Pages that truly
  // need Supabase will surface their own error; static/landing pages still render.
  let url: string
  let anonKey: string
  try {
    ;({ url, anonKey } = getSupabasePublicConfig())
  } catch (e) {
    console.error('[middleware] Supabase config unavailable — skipping auth refresh:', e instanceof Error ? e.message : e)
    return response
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh/sync auth cookies for server routes. No redirects here to avoid loops.
  await supabase.auth.getUser().catch(() => null)

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/login|auth/callback|auth/confirm|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
