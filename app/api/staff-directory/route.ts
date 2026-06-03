import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const team_slug = searchParams.get('team_slug')
  const search = searchParams.get('search')

  const adminClient = getAdminClient()

  let query = adminClient.from('staff_directory').select('*')

  if (team_slug) {
    query = query.eq('team_slug', team_slug)
  }

  if (search) {
    const searchTerm = `%${search}%`
    query = query.or(`first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},email.ilike.${searchTerm}`)
  }

  const { data, error } = await query.order('first_name').order('last_name')

  if (error) {
    console.error('Staff directory query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || [])
}
