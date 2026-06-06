import { isAdminEmail } from '@/lib/admin'

export type UserRole = 'student' | 'staff' | 'admin' | 'developer'

const VALID_ROLES: UserRole[] = ['student', 'staff', 'admin', 'developer']

const DEVELOPER_EMAILS = (process.env.DEVELOPER_EMAILS || process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function isValidRole(role: string): role is UserRole {
  return VALID_ROLES.includes(role as UserRole)
}

export async function getUserRole(_userId: string, email: string): Promise<UserRole | null> {
  // CFAC v1: derive role from email (ADMIN_EMAILS / DEVELOPER_EMAILS env).
  // Admin is also enforced via user_profiles.is_admin in lib/admin.
  return inferDefaultRole(email)
}

export async function setUserRole(_userId: string, _email: string, _role: UserRole): Promise<void> {
  // No-op in v1: roles are derived from env + user_profiles.is_admin, not a roles table.
}

export function inferDefaultRole(email: string): UserRole {
  const lower = email.toLowerCase()
  if (DEVELOPER_EMAILS.includes(lower)) return 'developer'
  if (isAdminEmail(lower)) return 'admin'
  return 'staff'
}

export function getHomeRoute(_role: UserRole): string {
  return '/hub'
}

export function plainStatus(status: string, builderStatus: string | null): { label: string; icon: string; description: string } {
  if (builderStatus === 'deployed' || status === 'done') {
    return { label: 'DONE', icon: '✓', description: 'Live and ready to use.' }
  }
  if (builderStatus === 'building' || builderStatus === 'pending') {
    return { label: 'BEING BUILT', icon: '⚡', description: 'Morgan is building this now.' }
  }
  if (status === 'rejected') {
    return { label: 'NOT MOVING FORWARD', icon: '✗', description: 'We decided not to build this right now.' }
  }
  return { label: 'IN QUEUE', icon: '◌', description: 'Leadership is reviewing this.' }
}
