import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'
import { sendEmail } from '@/lib/email'
import { emailDisabledJson, isEmailSendingEnabled } from '@/lib/email-control'
import { resolveAppBaseUrl } from '@/lib/url'

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [admin, teamCtx] = await Promise.all([
    checkIsAdmin(user.id, user.email || ''),
    getUserTeamContext(user.id),
  ])
  if (!admin && !teamCtx.canSeeAll) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { email, name, title, teamSlug, role } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (!isEmailSendingEnabled()) {
    return NextResponse.json(emailDisabledJson({ ok: false }), { status: 503 })
  }

  const adminClient = getAdminClient()
  const appUrl = resolveAppBaseUrl(req)

  // Check if user already exists
  const { data: existing } = await adminClient
    .from('user_profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .single()

  if (existing) {
    return NextResponse.json({ error: 'User already exists. Add them to a team instead.' }, { status: 409 })
  }

  // Look up team
  let teamName = ''
  if (teamSlug) {
    const { data: team } = await adminClient
      .from('teams').select('name').eq('slug', teamSlug).single()
    teamName = team?.name || teamSlug
  }

  // Send invite via Resend
  try {
    await sendEmail({
      from: `CFAC <${process.env.RESEND_FROM_EMAIL || 'noreply@cfacbentonco.com'}>`,
      to: email,
      subject: `You've been invited to CFAC`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0A0A0A;padding:24px;border-left:4px solid #C9A84C">
          <h1 style="color:#FFFFFF;margin:0;font-family:'Barlow Condensed',Arial;font-size:22px;text-transform:uppercase;letter-spacing:0.05em">
            Children &amp; Family Advocacy Center
          </h1>
        </div>
        <div style="padding:24px;background:#141416;border:1px solid #222">
          <p style="color:#D7D3CC;font-size:15px;line-height:1.6;margin:0 0 16px">
            ${name ? `Hey ${name}, you` : 'You'}'ve been added to the CFAC platform${teamName ? ` as <strong style="color:#fff">${role || 'member'}</strong> on the <strong style="color:#fff">${teamName}</strong> team` : ''}.
          </p>
          ${title ? `<p style="color:#8A8680;font-size:13px;margin:0 0 16px">Title: ${title}</p>` : ''}
          <p style="color:#D7D3CC;font-size:15px;line-height:1.6;margin:0 0 24px">
            Click below to set up your account and get started.
          </p>
          <a href="${appUrl}/auth/login"
            style="display:inline-block;background:#FFFFFF;color:#0A0A0A;text-decoration:none;
                   padding:14px 32px;font-weight:700;font-size:13px;text-transform:uppercase;
                   letter-spacing:0.1em">
            SET UP YOUR ACCOUNT
          </a>
        </div>
      </div>`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to send invite: ${err?.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: `Invite sent to ${email}`,
    note: teamSlug
      ? `They will be added to the ${teamName} team when they sign up.`
      : 'Add them to a team after they sign up.',
    pending: { email, name, title, teamSlug, role },
  })
}
