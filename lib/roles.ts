import { isAdminEmail } from '@/lib/admin'

export type UserRole = 'admin' | 'staff'

const VALID_ROLES: UserRole[] = ['admin', 'staff']

export function isValidRole(role: string): role is UserRole {
  return VALID_ROLES.includes(role as UserRole)
}

export function inferDefaultRole(email: string): UserRole {
  return isAdminEmail(email) ? 'admin' : 'staff'
}

// Roles derive from env (ADMIN_EMAILS) + user_profiles.is_admin — no roles table.
export async function getUserRole(_userId: string, email: string): Promise<UserRole> {
  return inferDefaultRole(email)
}

export async function setUserRole(_userId: string, _email: string, _role: UserRole): Promise<void> {
  // No-op in CFAC.
}

export function getHomeRoute(_role: UserRole): string {
  return '/hub'
}
