import { expect, test } from '@playwright/test'

function getTestCredentials() {
  const testEmail = process.env.TEST_USER_EMAIL
  const testPassword = process.env.TEST_USER_PASSWORD
  if (!testEmail || !testPassword) return null
  return { testEmail, testPassword }
}

async function login(page: any) {
  const creds = getTestCredentials()
  if (!creds) {
    test.skip(true, 'Skipping authenticated operations guard tests: missing TEST_USER_EMAIL or TEST_USER_PASSWORD.')
    return
  }

  await page.goto('/auth/login')
  await expect(page.locator('#si-email')).toBeVisible({ timeout: 10000 })
  await page.locator('#si-email').fill(creds.testEmail)
  await page.locator('#si-pw').fill(creds.testPassword)
  await page.locator('form [type="submit"], form button[type="submit"]').click()
  await page.waitForURL(/\/(home|overview|admin|requests|processes)/, { timeout: 20000 })
  await expect(page.getByRole('banner')).toBeVisible({ timeout: 10000 })
}

test.describe('Operations API guardrails (authenticated)', () => {
  test('requests PATCH enforces status and bounds validation', async ({ page }) => {
    await login(page)

    const createResponse = await page.request.post('/api/requests', {
      data: {
        raw_input: 'Need better tooling around mock RICE scoring for operations routing.',
        submitted_by: 'ops-guard-test',
        submitted_via: 'e2e',
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    const createdPayload = await createResponse.json()
    const requestId = createdPayload?.request?.id as string
    expect(requestId).toBeTruthy()

    const invalidStatus = await page.request.patch(`/api/requests/${requestId}`, {
      data: { status: 'not_a_real_status' },
    })

    if (invalidStatus.status() === 403) {
      test.skip(true, 'Authenticated test account is not admin; skipping admin-only request validations.')
      return
    }

    expect(invalidStatus.status()).toBe(400)

    const invalidBounds = await page.request.patch(`/api/requests/${requestId}`, {
      data: {
        status: 'scored',
        reach: 10000,
        confidence: -1,
      },
    })
    expect(invalidBounds.status()).toBe(400)

    const moveToScored = await page.request.patch(`/api/requests/${requestId}`, {
      data: { status: 'scored' },
    })
    expect(moveToScored.status()).toBe(200)

    const invalidTransition = await page.request.patch(`/api/requests/${requestId}`, {
      data: { status: 'done' },
    })
    expect(invalidTransition.status()).toBe(409)
  })

  test('work-orders PATCH enforces payload and status validation', async ({ page }) => {
    await login(page)

    const created = await page.request.post('/api/work-orders', {
      data: {
        category: 'facilities',
        description: 'E2E validation work order for guardrails.',
        priority: 'P3',
      },
    })
    expect(created.status()).toBe(201)

    const createdPayload = await created.json()
    const workOrderId = createdPayload?.id as string
    expect(workOrderId).toBeTruthy()

    const invalidStatus = await page.request.patch(`/api/work-orders/${workOrderId}`, {
      data: { status: 'bogus' },
    })

    if (invalidStatus.status() === 403) {
      test.skip(true, 'Authenticated test account cannot update this work order; skipping role-scoped validation.')
      return
    }

    expect(invalidStatus.status()).toBe(400)

    const emptyPatch = await page.request.patch(`/api/work-orders/${workOrderId}`, {
      data: {},
    })
    expect(emptyPatch.status()).toBe(400)
  })
})
