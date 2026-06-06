import { getAdminClient } from '@/lib/admin'

export type FeatureFlagKey = 'telemetry_events' | 'hope_schema_guard'

type FeatureFlagRow = {
  key: string
  enabled: boolean
  rollout_percent: number
  target_roles: string[] | null
  allowed_user_ids: string[] | null
}

type IsFeatureEnabledInput = {
  key: FeatureFlagKey
  userId?: string | null
  userRole?: string | null
  defaultEnabled?: boolean
}

function hashToPercent(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 100
}

export async function isFeatureEnabled(input: IsFeatureEnabledInput): Promise<boolean> {
  const { key, userId, userRole, defaultEnabled = false } = input

  try {
    const adminClient = getAdminClient()
    const { data, error } = await adminClient
      .from('feature_flags')
      .select('key, enabled, rollout_percent, target_roles, allowed_user_ids')
      .eq('key', key)
      .single()

    if (error || !data) {
      return defaultEnabled
    }

    const flag = data as FeatureFlagRow
    if (!flag.enabled) {
      return false
    }

    const allowedUsers = flag.allowed_user_ids || []
    if (userId && allowedUsers.includes(userId)) {
      return true
    }

    const roles = (flag.target_roles || []).map((role) => role.toLowerCase())
    if (roles.length > 0) {
      if (!userRole || !roles.includes(userRole.toLowerCase())) {
        return false
      }
    }

    const rollout = Math.max(0, Math.min(100, Number(flag.rollout_percent || 0)))
    if (rollout >= 100) {
      return true
    }

    if (!userId) {
      return false
    }

    return hashToPercent(`${key}:${userId}`) < rollout
  } catch (err) {
    console.error('[featureFlags] isFeatureEnabled failed:', err)
    return defaultEnabled
  }
}
