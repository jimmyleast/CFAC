/**
 * Team-based notification routing.
 *
 * Uses the teams + notification_rules tables to determine WHO gets notified
 * and HOW (email/sms) for any event. Every tool calls this instead of
 * hardcoding recipients.
 *
 * Usage:
 *   await notifyTeam('ops', 'work_order_created', 'New P1 Work Order', 'Plumbing issue in Building A', { threshold: 'P1_ONLY' })
 *   await notifyTeam('health', 'student_week2_flagged', 'Student Needs Check-In', 'John D. flagged: low energy + sleep issues')
 *   await notifyTeam('executive', 'p1_alert', 'P1 Alert', 'Something critical happened')
 */

import { getAdminClient } from '@/lib/admin'
import { sendEmail as dispatchEmail } from '@/lib/email'

interface NotifyOptions {
  threshold?: string
  data?: Record<string, any>
  url?: string
}

export async function notifyTeam(
  teamSlug: string,
  eventType: string,
  subject: string,
  body: string,
  options?: NotifyOptions,
): Promise<{ sent: number; errors: string[] }> {
  const result = { sent: 0, errors: [] as string[] }
  const adminClient = getAdminClient()

  // 1. Get the team
  const { data: team } = await adminClient
    .from('teams')
    .select('id')
    .eq('slug', teamSlug)
    .eq('active', true)
    .single()

  if (!team) {
    result.errors.push(`Team "${teamSlug}" not found`)
    return result
  }

  // 2. Get active notification rules for this team + event
  const { data: rules } = await adminClient
    .from('notification_rules')
    .select('channel, threshold')
    .eq('team_id', team.id)
    .eq('event_type', eventType)
    .eq('active', true)

  if (!rules?.length) return result

  // 3. Check threshold match
  const matchingRules = rules.filter(rule => {
    if (!rule.threshold || rule.threshold === 'ALL') return true
    if (!options?.threshold) return true
    return rule.threshold === options.threshold
  })

  if (matchingRules.length === 0) return result

  // 4. Get team members with contact info
  const { data: members } = await adminClient
    .from('team_members')
    .select('user_id, user_profiles(name, email, phone)')
    .eq('team_id', team.id)

  const contacts = (members || [])
    .map((m: any) => m.user_profiles)
    .filter(Boolean)

  if (contacts.length === 0) return result

  // 4b. Insert notification records for each team member
  const memberUserIds = (members || []).map((m: any) => m.user_id).filter(Boolean)
  if (memberUserIds.length > 0) {
    const notifRows = memberUserIds.map((uid: string) => ({
      user_id: uid,
      team_id: team.id,
      type: eventType,
      title: subject,
      body,
      action_url: options?.url || null,
    }))
    await adminClient.from('notifications').insert(notifRows).then(() => {})
  }

  const channels = new Set(matchingRules.map(r => r.channel))
  const sendEmail = channels.has('email') || channels.has('all')
  const sendSms = channels.has('sms') || channels.has('all')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  // 5. Send emails
  if (sendEmail) {
    const emails = contacts.map((c: any) => c.email).filter(Boolean)
    if (emails.length > 0) {
      try {
        await dispatchEmail({
          from: `UHP Ops <${process.env.RESEND_FROM_EMAIL || 'auth@uhp.com'}>`,
          to: emails,
          subject: `UHP: ${subject}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#0A0A0A;padding:20px 24px;border-left:4px solid #1AAFA0">
              <h2 style="color:#FFFFFF;margin:0;font-family:'Barlow Condensed',Arial;font-size:18px;text-transform:uppercase;letter-spacing:0.05em">${subject}</h2>
            </div>
            <div style="padding:20px 24px;background:#141416;border:1px solid #222">
              <p style="color:#D7D3CC;margin:0;font-size:14px;line-height:1.6">${body}</p>
            </div>
            ${options?.url ? `<div style="padding:16px 24px;background:#0A0A0A">
              <a href="${appUrl}${options.url}" style="display:inline-block;background:#FFFFFF;color:#0A0A0A;text-decoration:none;padding:12px 24px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.1em">VIEW DETAILS</a>
            </div>` : ''}
          </div>`,
        })
        result.sent += emails.length
      } catch (err: any) {
        result.errors.push(`email: ${err?.message || err}`)
      }
    }
  }

  // 6. Send SMS
  if (sendSms && process.env.TWILIO_ACCOUNT_SID) {
    const phones = contacts.map((c: any) => c.phone).filter(Boolean)
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64')

    for (const phone of phones) {
      try {
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: process.env.TWILIO_FROM_NUMBER!,
              To: phone,
              Body: `UHP: ${subject}\n${body}${options?.url ? `\n${appUrl}${options.url}` : ''}`,
            }).toString(),
          },
        )
        result.sent++
      } catch (err: any) {
        result.errors.push(`sms ${phone}: ${err?.message || err}`)
      }
    }
  }

  return result
}

/**
 * Notify multiple teams at once (e.g., P1 alerts go to ops + executive)
 */
export async function notifyTeams(
  teamSlugs: string[],
  eventType: string,
  subject: string,
  body: string,
  options?: NotifyOptions,
): Promise<{ sent: number; errors: string[] }> {
  const results = await Promise.allSettled(
    teamSlugs.map(slug => notifyTeam(slug, eventType, subject, body, options))
  )
  return results.reduce(
    (acc, r) => {
      if (r.status === 'fulfilled') {
        acc.sent += r.value.sent
        acc.errors.push(...r.value.errors)
      } else {
        acc.errors.push(r.reason?.message || 'Unknown error')
      }
      return acc
    },
    { sent: 0, errors: [] as string[] },
  )
}
