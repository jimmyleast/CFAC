import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('locations')
    .select('id, name, building, area, capacity, location_type, active')
    .eq('active', true)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ locations: data || [] })
}
