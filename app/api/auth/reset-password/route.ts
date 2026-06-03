import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { resolveAppBaseUrl } from '@/lib/url'
import { emailDisabledJson, isEmailSendingEnabled } from '@/lib/email-control'

function getAllowedDomains() {
  return (process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function getEmailDomain(email: string) {
  return email.split('@')[1]?.toLowerCase() || ''
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }

    const allowedDomains = getAllowedDomains()
    if (allowedDomains.length > 0 && !allowedDomains.includes(getEmailDomain(normalizedEmail))) {
      return NextResponse.json({ error: 'This email domain is not allowed.' }, { status: 403 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server auth is not configured.' }, { status: 500 })
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json({ error: 'Email delivery is not configured.' }, { status: 500 })
    }

    if (!isEmailSendingEnabled()) {
      return NextResponse.json(emailDisabledJson({ success: false }), { status: 503 })
    }

    const { url } = getSupabasePublicConfig()
    const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const siteUrl = resolveAppBaseUrl(request)

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: `${siteUrl}/auth/confirm?mode=recovery`,
      },
    })

    if (error) {
      // Avoid leaking user existence details.
      return NextResponse.json({ success: true })
    }

    const properties = (data as any)?.properties || {}
    const tokenHash = properties.hashed_token || properties.token_hash
    const appLink = tokenHash
      ? `${siteUrl}/auth/confirm?mode=recovery&type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
      : properties.action_link

    if (!appLink) {
      return NextResponse.json({ success: true })
    }

    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: 'Reset your UHP OPS password',
      html: `
        <div style="background:#0A0A0A;padding:40px 24px;font-family:'DM Sans',Arial,sans-serif;color:#F0EDE6;">
          <div style="max-width:520px;margin:0 auto;background:#111111;border:1px solid #2A2A2A;padding:32px;">
            <h1 style="margin:0 0 6px;font-size:32px;line-height:1;color:#F0EDE6;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">UHP OPS</h1>
            <p style="margin:0 0 28px;color:#8A8680;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Operations Platform</p>
            <p style="margin:0 0 24px;color:#F0EDE6;font-size:15px;">Click the button below to set a new password.</p>
            <a href="${appLink}" style="display:inline-block;background:#FFFFFF;color:#0A0A0A;text-decoration:none;font-weight:700;padding:14px 28px;font-size:13px;font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Reset Password</a>
            <p style="margin:28px 0 6px;color:#4A4845;font-size:11px;">Or copy and paste this link:</p>
            <p style="margin:0;color:#8A8680;font-size:11px;word-break:break-all;">${appLink}</p>
          </div>
        </div>
      `,
    })

    if ((emailResult as any).error) {
      return NextResponse.json({ error: (emailResult as any).error.message || 'Failed to send email.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Reset password email error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
