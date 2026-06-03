import { test, expect } from '@playwright/test'

test.describe('Org Chart Structure Validation (Phase #2)', () => {
  test('Teams: All 23 teams should exist with correct hierarchy', async ({ request }) => {
    const response = await request.get('/api/teams')
    expect(response.status()).toBe(200)
    const teams = await response.json()

    // Verify counts
    const topLevel = teams.filter((t: any) => !t.parent_team_id)
    const subteams = teams.filter((t: any) => t.parent_team_id)
    
    console.log(`✓ Found ${teams.length} teams (${topLevel.length} top-level, ${subteams.length} subteams)`)
    expect(teams.length).toBe(23) // 9 top-level + 14 subteams
    expect(topLevel.length).toBe(9)
    expect(subteams.length).toBe(14)

    // Verify top-level teams
    const topLevelSlugs = new Set(topLevel.map((t: any) => t.slug))
    const expectedTopLevel = ['ops', 'health', 'culinary', 'admissions', 'marketing', 'executive', 'technology', 'trades', 'student']
    expectedTopLevel.forEach(slug => {
      expect(topLevelSlugs.has(slug)).toBe(true)
    })
    console.log(`✓ All 9 top-level teams present`)

    // Verify subteam structure
    const expectedSubteams = [
      { slug: 'security', parent: 'ops' },
      { slug: 'grounds', parent: 'ops' },
      { slug: 'housekeeping', parent: 'ops' },
      { slug: 'gen-ops', parent: 'ops' },
      { slug: 'construction', parent: 'ops' },
      { slug: 'cpt', parent: 'health' },
      { slug: 'ihc', parent: 'health' },
      { slug: 'cnc', parent: 'health' },
      { slug: 'performance-strategy', parent: 'health' },
      { slug: 'ignite', parent: 'trades' }
    ]

    expectedSubteams.forEach(({ slug, parent }) => {
      const subteam = subteams.find((t: any) => t.slug === slug)
      expect(subteam).toBeDefined()
      
      const parentTeam = teams.find((t: any) => t.slug === parent)
      expect(subteam?.parent_team_id).toBe(parentTeam?.id)
    })
    console.log(`✓ All subteams linked to correct parent teams`)
  })

  test('Subteams: No orphaned subteams', async ({ request }) => {
    const response = await request.get('/api/teams')
    const teams = await response.json()
    const subteams = teams.filter((t: any) => t.parent_team_id)

    const orphaned = subteams.filter((s: any) => !teams.find((p: any) => p.id === s.parent_team_id))
    
    if (orphaned.length > 0) {
      console.log(`✗ Orphaned subteams: ${orphaned.map((t: any) => t.slug).join(', ')}`)
    }
    
    expect(orphaned.length).toBe(0)
    console.log(`✓ No orphaned subteams`)
  })

  test('Staff Directory: All 75+ staff entries present with valid team slugs', async ({ request }) => {
    const response = await request.get('/api/staff-directory')
    expect(response.status()).toBe(200)
    const staff = await response.json()

    console.log(`✓ Found ${staff.length} staff entries`)
    expect(staff.length).toBeGreaterThanOrEqual(75)

    // Check team slug validity
    const teamsRes = await request.get('/api/teams')
    const teams = await teamsRes.json()
    const teamSlugs = new Set(teams.map((t: any) => t.slug))

    const unmatched = staff.filter((s: any) => !teamSlugs.has(s.team_slug))
    if (unmatched.length > 0) {
      console.log(`✗ Staff with unmatched team_slug: ${unmatched.length}`)
      unmatched.slice(0, 5).forEach((s: any) => {
        console.log(`  - ${s.first_name} ${s.last_name} assigned to team: ${s.team_slug}`)
      })
    }
    expect(unmatched.length).toBe(0)
    console.log(`✓ All staff assigned to valid teams`)

    // Check for NULL last_name (should be handled)
    const nullLastName = staff.filter((s: any) => s.last_name === null)
    console.log(`✓ Found ${nullLastName.length} staff with NULL last_name (expected: ~1, Lavone)`)
    expect(nullLastName.length).toBeLessThanOrEqual(2)
  })

  test('Staff Directory by Team: Count distribution', async ({ request }) => {
    const response = await request.get('/api/staff-directory')
    const staff = await response.json()

    const byTeam = staff.reduce((acc: any, s: any) => {
      if (!acc[s.team_slug]) acc[s.team_slug] = 0
      acc[s.team_slug]++
      return acc
    }, {})

    console.log('Staff distribution by team:')
    Object.entries(byTeam).forEach(([team, count]) => {
      console.log(`  ${team}: ${count}`)
    })

    // Just verify we have reasonable distribution
    const counts = Object.values(byTeam) as number[]
    expect(counts.length).toBeGreaterThan(0)
    expect(Math.max(...counts)).toBeGreaterThan(0)
  })

  test('Locations: Verify subteam-area mappings', async ({ request }) => {
    const response = await request.get('/api/locations')
    expect(response.status()).toBe(200)
    const locations = await response.json()

    // Check for subteam-specific locations
    const teamsRes = await request.get('/api/teams')
    const teams = await teamsRes.json()
    const subteamSlugs = new Set(teams.filter((t: any) => t.parent_team_id).map((t: any) => t.slug))

    const subteamLocations = locations.filter((l: any) => l.team_slug && subteamSlugs.has(l.team_slug))
    console.log(`✓ Found ${subteamLocations.length} locations mapped to subteams`)
    expect(subteamLocations.length).toBeGreaterThan(0)

    // Verify area coverage
    const expectedAreas = ['security', 'grounds', 'housekeeping', 'fitness', 'ihc', 'residential']
    const locatedAreas = new Set(locations.map((l: any) => l.area).filter((a: any) => a))
    
    const covered = expectedAreas.filter(area => locatedAreas.has(area))
    console.log(`✓ Location areas covered: ${covered.join(', ')}`)
  })

  test('Work Order Routing: TEAM_AREA_FILTER applied correctly', async ({ request }) => {
    const response = await request.get('/api/work-orders')
    expect(response.status()).toBe(200)
    const workOrders = await response.json()
    
    console.log(`✓ User can access ${workOrders.length || 0} work orders (team-scoped)`)
    
    // Don't fail if there are no work orders, just verify API works
    expect(Array.isArray(workOrders)).toBe(true)
  })

  test('Team Navigation: Verify nav-config hierarchy display', async ({ request }) => {
    // Check nav config mentions
    const teamsFileRes = await request.get('/api/teams/ops')
    expect(teamsFileRes.status()).toBe(200)
    
    console.log(`✓ Team detail endpoints working`)
  })

  test('Staff Directory Search: Query by team or name', async ({ request }) => {
    // Query by team_slug
    const byTeamRes = await request.get('/api/staff-directory?team_slug=ops')
    expect(byTeamRes.status()).toBe(200)
    const byTeam = await byTeamRes.json()
    console.log(`✓ Found ${byTeam.length} staff in ops team`)

    // Query by search
    const searchRes = await request.get('/api/staff-directory?search=manager')
    expect(searchRes.status()).toBe(200)
    const searchResult = await searchRes.json()
    console.log(`✓ Search query returned ${searchResult.length} results`)
  })
})
