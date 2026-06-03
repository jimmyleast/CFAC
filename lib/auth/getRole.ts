import { checkIsAdmin, getAdminClient } from '@/lib/admin'

export type UserRole = 'admin' | 'squad_lead' | 'staff'

export async function getUserRole(userId: string, email: string): Promise<UserRole> {
  if (await checkIsAdmin(userId, email)) return 'admin'

  const adminClient = getAdminClient()
  const { data } = await adminClient
    .from('user_roles')
    .select('role')
    .eq('email', email.toLowerCase())
    .single()

  if (data?.role === 'squad_lead') return 'squad_lead'
  return 'staff'
}
