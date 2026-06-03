import { getAdminClient } from '@/lib/admin'
import { sendEmail } from '@/lib/email'

interface TeamMember {
  id: string; name: string; role: string; email: string;
  phone?: string; slack_user_id?: string;
  categories: string[]; priority_threshold: string; notify_via: string[];
}

interface Ticket {
  id: string; title: string; description?: string;
  category: string; rice_score?: number; status: string;
  submitted_by: string; submitted_via: string;
}

function getPriority(score: number) {
  if (score >= 100) return 'CRITICAL'
  if (score >= 50) return 'HIGH'
  if (score >= 20) return 'MEDIUM'
  return 'LOW'
}

function isSafety(ticket: Ticket) {
  const keywords = ['safety', 'injury', 'hazard', 'emergency', 'danger',
    'accident', 'fire', 'gas leak', 'electrical hazard', 'hurt', 'bleeding']
  return keywords.some(k =>
    `${ticket.title} ${ticket.description}`.toLowerCase().includes(k))
}

export async function assignTicket(ticket: Ticket): Promise<TeamMember | null> {
  const adminClient = getAdminClient()
  const { data: team } = await adminClient
    .from('uhp_team_directory').select('*').eq('is_active', true)
  if (!team) return null

  const match = team.find((m: any) =>
    m.categories.some((c: string) =>
      ticket.category.toLowerCase().includes(c.toLowerCase())))

  const owner = match || team.find((m: any) => m.role === 'COO') || team[0]
  if (!owner) return null

  await adminClient.from('uhp_requests').update({
    assigned_to: owner.id, assigned_at: new Date().toISOString()
  }).eq('id', ticket.id)

  return owner
}

export async function notifyOnNewTicket(ticket: Ticket): Promise<void> {
  const adminClient = getAdminClient()
  const priority = getPriority(ticket.rice_score || 0)
  const safety = isSafety(ticket)
  const owner = await assignTicket(ticket)
  if (!owner) return

  const { data: allTeam } = await adminClient
    .from('uhp_team_directory').select('*').eq('is_active', true)

  const recipients = (safety || priority === 'CRITICAL')
    ? (allTeam || []) : [owner]

  const promises: Promise<unknown>[] = []

  for (const r of recipients) {
    const shouldNotify = safety ||
      r.priority_threshold === 'all' ||
      (r.priority_threshold === 'critical' && priority === 'CRITICAL') ||
      (r.priority_threshold === 'high' && ['CRITICAL', 'HIGH'].includes(priority))

    if (!shouldNotify && r.id !== owner.id) continue

    if (r.notify_via.includes('slack') && process.env.SLACK_BOT_TOKEN && r.slack_user_id) {
      promises.push(slackDM(r, ticket, priority, safety, owner))
    }
    if (r.notify_via.includes('email')) {
      promises.push(emailNotify(r, ticket, priority, safety, owner))
    }
    if ((safety || priority === 'CRITICAL' || r.notify_via.includes('sms'))
        && r.phone && process.env.TWILIO_ACCOUNT_SID) {
      promises.push(smsNotify(r, ticket, priority, safety))
    }
  }

  promises.push(submitterConfirm(ticket, owner, priority))
  promises.push(opsChannelPost(ticket, owner, priority, safety))

  await Promise.allSettled(promises)
  await adminClient.from('uhp_requests')
    .update({ notified_at: new Date().toISOString() }).eq('id', ticket.id)
}

async function slackDM(r: TeamMember, ticket: Ticket, priority: string,
  safety: boolean, owner: TeamMember) {
  const emoji = safety ? '🚨' : priority === 'CRITICAL' ? '🔴' :
    priority === 'HIGH' ? '🟡' : '🟢'
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: r.slack_user_id,
        text: `${emoji} ${safety ? 'SAFETY ISSUE' : priority}: *${ticket.title}*`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `${emoji} ${ticket.title}` } },
          { type: 'section', fields: [
            { type: 'mrkdwn', text: `*Priority:*\n${priority}` },
            { type: 'mrkdwn', text: `*Category:*\n${ticket.category}` },
            { type: 'mrkdwn', text: `*Assigned:*\n${owner.name}` },
            { type: 'mrkdwn', text: `*From:*\n${ticket.submitted_by}` },
          ]},
          { type: 'actions', elements: [
            { type: 'button', style: 'primary',
              text: { type: 'plain_text', text: 'View Ticket →' },
              url: `${process.env.NEXT_PUBLIC_APP_URL}/requests/backlog/${ticket.id}` }
          ]}
        ]
      }),
    })
  } catch (err) {
    console.error('[notify] slackDM failed:', err)
  }
}

async function smsNotify(r: TeamMember, ticket: Ticket, priority: string, safety: boolean) {
  const prefix = safety ? '🚨 SAFETY: ' : priority === 'CRITICAL' ? '🔴 CRITICAL: ' : ''
  try {
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64')
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      { method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: process.env.TWILIO_FROM_NUMBER!,
          To: r.phone!,
          Body: `${prefix}UHP: ${ticket.title} — ${ticket.category} · ${process.env.NEXT_PUBLIC_APP_URL}/requests/backlog/${ticket.id}`,
        }).toString(),
      }
    )
  } catch (err) {
    console.error('[notify] smsNotify failed:', err)
  }
}

async function emailNotify(r: TeamMember, ticket: Ticket, priority: string,
  safety: boolean, owner: TeamMember) {
  const emoji = safety ? '🚨' : priority === 'CRITICAL' ? '🔴' :
    priority === 'HIGH' ? '🟡' : ''
  try {
    await sendEmail({
      from: `UHP Ops <${process.env.RESEND_FROM_EMAIL || 'auth@uhp.com'}>`,
      to: r.email,
      subject: `${emoji} [${safety ? 'SAFETY' : priority}] ${ticket.title}`,
      html: `<div style="font-family:sans-serif;background:#0D0D0F;color:#F0EDE6;padding:32px;max-width:600px">
        <h1 style="font-size:20px;color:#fff">UHP — New ${safety ? 'Safety Issue' : priority} Request</h1>
        <h2 style="color:#fff">${ticket.title}</h2>
        <p style="color:#8A8680">${ticket.description || ''}</p>
        <p><b style="color:#fff">Category:</b> <span style="color:#8A8680">${ticket.category}</span></p>
        <p><b style="color:#fff">Assigned to:</b> <span style="color:#8A8680">${owner.name}</span></p>
        <p><b style="color:#fff">Submitted by:</b> <span style="color:#8A8680">${ticket.submitted_by}</span></p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/requests/backlog/${ticket.id}"
          style="display:block;background:#fff;color:#000;text-align:center;padding:14px;
                 font-weight:700;text-decoration:none;margin-top:24px;text-transform:uppercase">
          VIEW TICKET →
        </a>
      </div>`,
    })
  } catch (err) {
    console.error('[notify] emailNotify failed:', err)
  }
}

async function submitterConfirm(ticket: Ticket, owner: TeamMember, priority: string) {
  const email = ticket.submitted_by.includes('@') &&
    !ticket.submitted_by.startsWith('slack:')
    ? ticket.submitted_by : null
  if (!email) return

  try {
    await sendEmail({
      from: `UHP Ops <${process.env.RESEND_FROM_EMAIL || 'auth@uhp.com'}>`,
      to: email,
      subject: `Received: ${ticket.title}`,
      html: `<div style="font-family:sans-serif;background:#0D0D0F;color:#F0EDE6;padding:32px;max-width:600px">
        <h1 style="font-size:20px;color:#fff">UHP — We got it</h1>
        <p style="color:#fff"><b>${ticket.title}</b> has been logged and assigned to ${owner.name}.</p>
        <p style="color:#8A8680">Priority: ${priority}. You'll hear back when there's an update.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/my-requests"
          style="display:block;background:#fff;color:#000;text-align:center;padding:14px;
                 font-weight:700;text-decoration:none;margin-top:24px;text-transform:uppercase">
          TRACK YOUR REQUESTS →
        </a>
      </div>`,
    })
  } catch (err) {
    console.error('[notify] submitterConfirm failed:', err)
  }
}

async function opsChannelPost(ticket: Ticket, owner: TeamMember,
  priority: string, safety: boolean) {
  if (!process.env.SLACK_BOT_TOKEN) return
  const channelId = safety || priority === 'CRITICAL'
    ? process.env.SLACK_CHANNEL_URGENT
    : ['tool', 'system', 'tech'].includes(ticket.category)
    ? process.env.SLACK_CHANNEL_TECH
    : process.env.SLACK_CHANNEL_OPS
  if (!channelId) return
  const emoji = safety ? '🚨' : priority === 'CRITICAL' ? '🔴' :
    priority === 'HIGH' ? '🟡' : '🟢'
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: channelId,
        text: `${emoji} *${ticket.title}* — ${priority} · ${ticket.category} · Assigned: ${owner.name}`,
      }),
    })
  } catch (err) {
    console.error('[notify] opsChannelPost failed:', err)
  }
}

export async function notifyOnStatusChange(ticketId: string,
  newStatus: string, notes?: string) {
  const adminClient = getAdminClient()
  const { data: ticket } = await adminClient
    .from('uhp_requests').select('*').eq('id', ticketId).single()
  if (!ticket) return

  const email = ticket.submitted_by?.includes('@') &&
    !ticket.submitted_by.startsWith('slack:')
    ? ticket.submitted_by : null

  const messages: Record<string, string> = {
    accepted: `Your request "${ticket.title}" has been accepted.`,
    in_progress: `We're working on "${ticket.title}" now.`,
    done: `"${ticket.title}" is complete and live. ${notes || ''}`,
    rejected: `We won't be moving forward with "${ticket.title}" right now. ${notes || ''}`,
  }

  if (email && messages[newStatus]) {
    try {
      await sendEmail({
        from: `UHP Ops <${process.env.RESEND_FROM_EMAIL || 'auth@uhp.com'}>`,
        to: email,
        subject: `Update: ${ticket.title}`,
        html: `<div style="font-family:sans-serif;background:#0D0D0F;color:#F0EDE6;padding:32px">
          <h1 style="color:#fff">UHP Update</h1>
          <p style="color:#8A8680">${messages[newStatus]}</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/my-requests"
            style="display:block;background:#fff;color:#000;text-align:center;
                   padding:14px;font-weight:700;text-decoration:none;margin-top:16px">
            VIEW YOUR REQUESTS →
          </a>
        </div>`,
      })
    } catch (err) {
      console.error('[notify] statusChange email failed:', err)
    }
  }

  if (newStatus === 'done' && process.env.SLACK_CHANNEL_OPS && process.env.SLACK_BOT_TOKEN) {
    try {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: process.env.SLACK_CHANNEL_OPS,
          text: `✅ *${ticket.title}* is now live. ${notes || ''}`,
        }),
      })
    } catch (err) {
      console.error('[notify] done slack failed:', err)
    }
  }
}
