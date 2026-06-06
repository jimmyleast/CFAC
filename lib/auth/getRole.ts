import { checkIsAdmin } from '@/lib/admin'

export type UserRole = 'admin' | 'staff'

export async function getUserRole(userId: string, email: string): Promise<UserRole> {
  return (await checkIsAdmin(userId, email)) ? 'admin' : 'staff'
}
