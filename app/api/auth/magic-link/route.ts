import { sendEmail } from '@/lib/email'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { upsertUserProfile } from '@/lib/admin'
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

    const appBaseUrl = resolveAppBaseUrl(request)
    const redirectTo = `${appBaseUrl}/auth/confirm?mode=magiclink`

    let linkResponse = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
      options: {
        redirectTo,
      },
    })

    if (linkResponse.error && /user/i.test(linkResponse.error.message)) {
      const createUserResponse = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
      })

      if (createUserResponse.error) {
        return NextResponse.json({ error: createUserResponse.error.message }, { status: 500 })
      }

      // Create user profile for new users
      if (createUserResponse.data?.user) {
        await upsertUserProfile(createUserResponse.data.user.id, normalizedEmail)
      }

      linkResponse = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
        options: {
          redirectTo,
        },
      })
    }

    if (linkResponse.error) {
      return NextResponse.json({ error: linkResponse.error.message }, { status: 500 })
    }

    const actionLink = (linkResponse.data as any)?.properties?.action_link || (linkResponse.data as any)?.action_link
    if (!actionLink) {
      return NextResponse.json({ error: 'Magic link generation failed.' }, { status: 500 })
    }

    // Upsert user profile so it always exists (picks up admin flag from ADMIN_EMAILS)
    const linkUser = (linkResponse.data as any)?.user
    if (linkUser?.id) {
      await upsertUserProfile(linkUser.id, normalizedEmail)
    }

    const emailResult = await sendEmail({
      to: normalizedEmail,
      subject: 'Your CFAC sign-in link',
      html: `
        <div style="background:#0A0A0A;padding:40px 24px;font-family:'DM Sans',Arial,sans-serif;color:#F0EDE6;">
          <div style="max-width:520px;margin:0 auto;background:#111111;border:1px solid #2A2A2A;padding:32px;">
            <h1 style="margin:0 0 6px;font-size:32px;line-height:1;color:#F0EDE6;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">CFAC</h1>
            <p style="margin:0 0 28px;color:#8A8680;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Operations Platform</p>
            <p style="margin:0 0 24px;color:#F0EDE6;font-size:15px;">Use the button below to sign in.</p>
            <a href="${actionLink}" style="display:inline-block;background:#FFFFFF;color:#0A0A0A;text-decoration:none;font-weight:700;padding:14px 28px;font-size:13px;font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Sign In</a>
            <p style="margin:28px 0 6px;color:#4A4845;font-size:11px;">Or copy and paste this link:</p>
            <p style="margin:0;color:#8A8680;font-size:11px;word-break:break-all;">${actionLink}</p>
          </div>
        </div>
      `,
    })

    if ((emailResult as any).error) {
      return NextResponse.json({ error: (emailResult as any).error.message || 'Failed to send email.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Magic link error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}
