import { expect, test } from '@playwright/test'

type GuardCase = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  expected: number
}

const protectedApiCases: GuardCase[] = [
  { method: 'GET', path: '/api/me', expected: 401 },
  { method: 'GET', path: '/api/process', expected: 401 },
  { method: 'POST', path: '/api/process', expected: 401 },
  { method: 'GET', path: '/api/process/not-real-id', expected: 401 },
  { method: 'PATCH', path: '/api/process/not-real-id', expected: 401 },
  { method: 'DELETE', path: '/api/process/not-real-id', expected: 401 },
  { method: 'POST', path: '/api/process/not-real-id/duplicate', expected: 401 },
  { method: 'POST', path: '/api/chat', expected: 401 },
  { method: 'POST', path: '/api/morgan/token', expected: 401 },
  { method: 'GET', path: '/api/morgan/config', expected: 401 },
  { method: 'POST', path: '/api/morgan/chat', expected: 401 },
  { method: 'GET', path: '/api/squads', expected: 401 },
  { method: 'POST', path: '/api/export/not-real-id', expected: 401 },
  { method: 'POST', path: '/api/admin/invite', expected: 401 },
  { method: 'GET', path: '/api/admin/users', expected: 401 },
  { method: 'GET', path: '/api/admin/squads', expected: 401 },
  { method: 'PATCH', path: '/api/admin/squads/not-real-id', expected: 401 },
  { method: 'POST', path: '/api/admin/squads/not-real-id/members', expected: 401 },
  { method: 'POST', path: '/api/upload/not-real-id', expected: 401 },
  { method: 'GET', path: '/api/work-orders/locations', expected: 401 },
  { method: 'PATCH', path: '/api/work-orders/not-real-id', expected: 401 },
  { method: 'PATCH', path: '/api/requests/not-real-id', expected: 401 },
  { method: 'GET', path: '/api/scheduling/conflicts', expected: 401 },
  { method: 'GET', path: '/api/discovery/not-real-id/transcript', expected: 401 },
  { method: 'GET', path: '/api/discovery/not-real-id/upload', expected: 401 },
]

test.describe('Public auth API contracts', () => {
  test('auth login rejects missing credentials', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(String(body.error || '')).toContain('required')
  })

  test('magic-link rejects invalid email format', async ({ request }) => {
    const res = await request.post('/api/auth/magic-link', { data: { email: 'not-an-email' } })
    expect(res.status()).toBe(400)
  })

  test('reset-password rejects invalid email format', async ({ request }) => {
    const res = await request.post('/api/auth/reset-password', { data: { email: 'bad' } })
    expect(res.status()).toBe(400)
  })
})

test.describe('Protected API contracts', () => {
  for (const item of protectedApiCases) {
    test(`${item.method} ${item.path} returns ${item.expected} when unauthenticated`, async ({ request }) => {
      const payload = { data: { message: 'e2e-contract-test' } }
      const response =
        item.method === 'GET'
          ? await request.get(item.path)
          : item.method === 'POST'
          ? await request.post(item.path, payload)
          : item.method === 'PATCH'
          ? await request.patch(item.path, payload)
          : await request.delete(item.path)

      expect(response.status(), `${item.method} ${item.path}`).toBe(item.expected)
    })
  }
})

test.describe('Route guards', () => {
  test('unauthenticated user can access public landing page at /', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /unlock human potential/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
  })

  const guardedRoutes = ['/process/new', '/process/not-real-id', '/admin', '/admin/people']

  for (const route of guardedRoutes) {
    test(`unauthenticated user is forced to login for ${route}`, async ({ page }) => {
      await page.goto(route)
      await page.waitForURL(/\/auth\/login/, { timeout: 25000 })
      await expect(page.locator('#si-email')).toBeVisible()
    })
  }
})
