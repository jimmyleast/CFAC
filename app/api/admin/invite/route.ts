import { sendEmail } from '@/lib/email'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { checkIsAdmin, getAdminClient, upsertUserProfile } from '@/lib/admin'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { elapsedMs, emitAppEvent } from '@/lib/telemetry/events'
import { isFeatureEnabled } from '@/lib/featureFlags'
import { resolveAppBaseUrl } from '@/lib/url'
import { emailDisabledJson, isEmailSendingEnabled } from '@/lib/email-control'

function isLocalhostBaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return true
  }
}

function forceRedirectTarget(actionLink: string, appBaseUrl: string) {
  try {
    const parsed = new URL(actionLink)
    parsed.searchParams.set('redirect_to', `${appBaseUrl}/auth/confirm?mode=magiclink`)
    return parsed.toString()
  } catch {
    return actionLink
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const telemetryEnabled = await isFeatureEnabled({ key: 'telemetry_events', userId: user.id, defaultEnabled: true })
  const track = (input: Parameters<typeof emitAppEvent>[0]) => {
    if (!telemetryEnabled) return
    void emitAppEvent(input)
  }

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'email_not_configured',
      durationMs: elapsedMs(startedAt),
    })
    return NextResponse.json({ error: 'Email delivery is not configured.' }, { status: 500 })
  }

  if (!isEmailSendingEnabled()) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'email_disabled',
      durationMs: elapsedMs(startedAt),
    })
    return NextResponse.json(emailDisabledJson({ success: false }), { status: 503 })
  }

  const { email, squad_id, squad_name, invited_by_name } = await request.json()
  const rawEmail = String(email || '').trim()
  // Handle "Display Name <email@domain.com>" format
  const angleMatch = rawEmail.match(/<([^>]+)>/)
  const normalizedEmail = (angleMatch ? angleMatch[1] : rawEmail).trim().toLowerCase()

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'invalid_email',
      durationMs: elapsedMs(startedAt),
      metadata: { email: normalizedEmail },
    })
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const { url } = getSupabasePublicConfig()
  const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Create user if they don't exist
  let targetUserId: string | null = null
  const { data: listData } = await supabaseAdmin.auth.admin.listUsers()
  const existing = listData?.users?.find(u => u.email?.toLowerCase() === normalizedEmail)

  if (existing) {
    targetUserId = existing.id
  } else {
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
    })
    if (createError) {
      track({
        eventName: 'admin.invite.failed',
        category: 'error',
        userId: user.id,
        route: '/api/admin/invite',
        status: 'create_user_failed',
        durationMs: elapsedMs(startedAt),
        metadata: { error: createError.message, email: normalizedEmail },
      })
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }
    targetUserId = newUser.user?.id || null
  }

  if (!targetUserId) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'missing_target_user',
      durationMs: elapsedMs(startedAt),
      metadata: { email: normalizedEmail },
    })
    return NextResponse.json({ error: 'Could not create user.' }, { status: 500 })
  }

  // Upsert profile
  await upsertUserProfile(targetUserId, normalizedEmail)

  // Add to squad if specified
  const adminClient = getAdminClient()
  if (squad_id) {
    await adminClient.from('squad_members').upsert(
      { squad_id, user_id: targetUserId, role: 'member' },
      { onConflict: 'squad_id,user_id' }
    )
  }

  // Generate magic link for them
  const appBaseUrl = resolveAppBaseUrl(request)
  if (isLocalhostBaseUrl(appBaseUrl) && process.env.NODE_ENV !== 'development') {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'invalid_redirect_base_url',
      durationMs: elapsedMs(startedAt),
      metadata: { appBaseUrl },
    })
    return NextResponse.json(
      { error: 'Invite links are misconfigured (localhost redirect). Set SITE_URL to your hosted app URL.' },
      { status: 500 },
    )
  }
  const redirectTo = `${appBaseUrl}/auth/confirm?mode=magiclink`

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: normalizedEmail,
    options: { redirectTo },
  })

  if (linkError) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'magic_link_failed',
      durationMs: elapsedMs(startedAt),
      metadata: { error: linkError.message, email: normalizedEmail },
    })
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }
  const rawActionLink = (linkData as any)?.properties?.action_link
  const actionLink = forceRedirectTarget(rawActionLink || '', appBaseUrl)

  if (!actionLink) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'missing_action_link',
      durationMs: elapsedMs(startedAt),
      metadata: { email: normalizedEmail },
    })
    return NextResponse.json({ error: 'Magic link generation failed.' }, { status: 500 })
  }

  // Send branded invite email
  const inviterName = invited_by_name || user.email?.split('@')[0] || 'Your team'
  const squadLine = squad_name ? `<p style="margin:0 0 20px;color:#8A8680;font-size:14px;">You've been added to the <strong style="color:#C9A84C;">${squad_name}</strong> squad.</p>` : ''

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject: `${inviterName} invited you to CFAC`,
    html: `
      <div style="background:#0A0A0A;padding:40px 24px;font-family:'DM Sans',Arial,sans-serif;color:#F0EDE6;">
        <div style="max-width:520px;margin:0 auto;background:#111111;border:1px solid #2A2A2A;padding:32px;">
          <h1 style="margin:0 0 6px;font-size:32px;line-height:1;color:#F0EDE6;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">CFAC</h1>
          <p style="margin:0 0 28px;color:#8A8680;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Operations Platform</p>
          <p style="margin:0 0 16px;color:#F0EDE6;font-size:15px;"><strong>${inviterName}</strong> has invited you to join CFAC.</p>
          ${squadLine}
          <p style="margin:0 0 24px;color:#8A8680;font-size:14px;">Click the button below to sign in. No password required.</p>
          <a href="${actionLink}" style="display:inline-block;background:#FFFFFF;color:#0A0A0A;text-decoration:none;font-weight:700;padding:14px 28px;font-size:13px;font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;">Accept Invite</a>
          <p style="margin:28px 0 6px;color:#4A4845;font-size:11px;">Or copy and paste this link:</p>
          <p style="margin:0;color:#8A8680;font-size:11px;word-break:break-all;">${actionLink}</p>
        </div>
      </div>
    `,
  })

  if ((emailResult as any).error) {
    track({
      eventName: 'admin.invite.failed',
      category: 'error',
      userId: user.id,
      route: '/api/admin/invite',
      status: 'email_send_failed',
      durationMs: elapsedMs(startedAt),
      metadata: { error: (emailResult as any).error.message, email: normalizedEmail },
    })
    return NextResponse.json({ error: (emailResult as any).error.message }, { status: 500 })
  }

  const messageId = (emailResult as any)?.data?.id || (emailResult as any)?.id || null
  const includeLinkInResponse = String(process.env.EXPOSE_INVITE_LINK_IN_RESPONSE || '').toLowerCase() === 'true'

  track({
    eventName: 'admin.invite.sent',
    category: 'funnel',
    userId: user.id,
    route: '/api/admin/invite',
    status: 'sent',
    durationMs: elapsedMs(startedAt),
    metadata: {
      email: normalizedEmail,
      squadId: squad_id || null,
      invitedUserId: targetUserId,
      messageId,
    },
  })

  return NextResponse.json({
    success: true,
    user_id: targetUserId,
    message_id: messageId,
    action_link: includeLinkInResponse ? actionLink : undefined,
  })
}
