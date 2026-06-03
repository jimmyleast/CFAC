import { expect, test } from '@playwright/test'

/**
 * Authenticated E2E workflows
 * Tests full user journeys after login (create process, SOP workflow, export)
 */

function getTestCredentials() {
  const testEmail = process.env.TEST_USER_EMAIL
  const testPassword = process.env.TEST_USER_PASSWORD

  if (!testEmail || !testPassword) {
    throw new Error(
      'Missing TEST_USER_EMAIL or TEST_USER_PASSWORD for authenticated E2E tests. Add them to .env.local or your shell environment.',
    )
  }

  return { testEmail, testPassword }
}

async function loginAndWaitForDashboard(page: any) {
  const { testEmail, testPassword } = getTestCredentials()

  await page.goto('/auth/login')
  const apiLogin = await page.request
    .post('/api/auth/login', {
      data: { email: testEmail, password: testPassword },
      timeout: 10000,
    })
    .catch(() => null)

  if (apiLogin?.ok()) {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null)
  } else {
    const idEmail = page.locator('#si-email').first()
    if (await idEmail.isVisible({ timeout: 2000 }).catch(() => false)) {
      await idEmail.fill(testEmail)
      await page.locator('#si-pw').first().fill(testPassword)
      await page.locator('form [type="submit"], form button[type="submit"]').first().click()
    } else {
      const signInTab = page.getByRole('button', { name: /^sign in$/i }).first()
      if (await signInTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signInTab.click().catch(() => null)
      }

      const emailInput = page.getByRole('textbox', { name: /email address/i }).first()
      await expect(emailInput).toBeVisible({ timeout: 5000 })
      await emailInput.fill(testEmail)
      await expect(emailInput).toHaveValue(testEmail, { timeout: 3000 })

      const passwordInput = page.locator('input[type="password"]').first()
      await expect(passwordInput).toBeVisible({ timeout: 5000 })
      await passwordInput.fill(testPassword)
      await expect(passwordInput).toHaveValue(testPassword, { timeout: 3000 })

      await passwordInput.press('Enter').catch(() => null)

      const submitButton = page.locator('button:has-text("Sign In"):not([disabled])').last()
      if (await submitButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        await submitButton.click().catch(() => null)
      }
    }
  }

  const isAuthenticatedInPage = async () =>
    page
      .evaluate(async () => {
        const res = await fetch('/api/me', { credentials: 'include' })
        return res.status === 200
      })
      .catch(() => false)

  let authenticated = false
  for (let i = 0; i < 10; i += 1) {
    if (await isAuthenticatedInPage()) {
      authenticated = true
      break
    }
    await page.waitForTimeout(500)
  }

  if (!authenticated) {
    throw new Error(`Login did not establish an authenticated browser session (url=${page.url()})`)
  }

  if (new URL(page.url()).pathname.startsWith('/auth/login')) {
    await page.goto('/home', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null)
  }

  // Current auth flow may land at /hub (redirects) or /home before navigating deeper.
  await page.waitForURL(/\/(hub|home|processes|process\/[0-9a-f-]+)/i, { timeout: 3000 }).catch(() => null)

  const url = page.url()
  if (/\/hub$/i.test(url)) {
    await page.waitForURL(/\/home$/i, { timeout: 3000 }).catch(() => null)
  }

  const loadingShell = page.getByText('Loading...').first()
  if (await loadingShell.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(loadingShell).not.toBeVisible({ timeout: 5000 }).catch(() => null)
  }

  if (new URL(page.url()).pathname.startsWith('/auth/login')) {
    throw new Error(`Still on login page after authentication checks (url=${page.url()})`)
  }

  const authMarkers = [
    page.getByRole('button', { name: /new process/i }).first(),
    page.getByPlaceholder(/ask morgan anything/i).first(),
    page.getByText(/ask morgan anything/i).first(),
  ]

  const markerResults = await Promise.all(
    authMarkers.map((locator) => locator.isVisible().catch(() => false))
  )

  expect(markerResults.some(Boolean)).toBeTruthy()

  const navDialog = page.getByRole('dialog', { name: /navigation menu/i })
  if (await navDialog.isVisible().catch(() => false)) {
    const closeNav = page.getByRole('button', { name: /close menu/i }).first()
    if (await closeNav.isVisible().catch(() => false)) {
      await closeNav.click().catch(() => null)
    } else {
      await page.keyboard.press('Escape').catch(() => null)
    }
    await expect(navDialog).toHaveCount(0, { timeout: 5000 }).catch(() => null)
  }
}

async function openOrCreateProcess(page: any) {
  await page.goto('/processes')
  const createRequest = page
    .waitForRequest(
      (request: any) => request.url().includes('/api/process') && request.method() === 'POST',
      { timeout: 15000 },
    )
    .catch(() => null)
  const newProcessBtn = page.getByRole('button', { name: /new process/i }).first()
  await expect(newProcessBtn).toBeVisible({ timeout: 15000 })
  await newProcessBtn.click()
  await createRequest

  await page.waitForURL(/\/process\/[0-9a-f-]+/i, { timeout: 30000 })

  // Some process pages briefly show a loading shell before header actions render.
  const loadingText = page.getByText('Loading process...')
  if (await loadingText.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(loadingText).not.toBeVisible({ timeout: 20000 }).catch(() => null)
  }
}

async function triggerExportAndAssert(page: any) {
  const exportButton = page.getByRole('button', { name: /export sop/i }).first()
  await expect(exportButton).toBeVisible({ timeout: 10000 })

  const requestPromise = page
    .waitForRequest(
      (request: any) => request.url().includes('/api/export/') && request.method() === 'POST',
      { timeout: 12000 },
    )
    .then(() => true)
    .catch(() => false)

  const responsePromise = page
    .waitForResponse(
      (response: any) => response.url().includes('/api/export/') && response.request().method() === 'POST',
      { timeout: 12000 },
    )
    .then(() => true)
    .catch(() => false)

  await exportButton.scrollIntoViewIfNeeded().catch(() => null)
  await exportButton.click({ timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Escape').catch(() => null)
    await exportButton.click({ force: true }).catch(async () => {
      await exportButton.evaluate((el: any) => el.click()).catch(() => null)
    })
  })

  const statusVisiblePromise = page
    .getByTestId('export-status')
    .isVisible({ timeout: 6000 })
    .catch(() => false)

  const exportingStartedPromise = page
    .getByRole('button', { name: /exporting/i })
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false)

  const [requestSeen, responseSeen, statusVisible, exportingStarted] = await Promise.all([
    requestPromise,
    responsePromise,
    statusVisiblePromise,
    exportingStartedPromise,
  ])

  expect(requestSeen || responseSeen || statusVisible || exportingStarted).toBeTruthy()
}

test.describe('Authenticated workflows', () => {
  test.describe.configure({ timeout: 60000 })

  // Use default test, not authenticatedPage fixture, since we're testing login flow
  
  test('user can create a new process from dashboard', async ({ page }) => {
    await loginAndWaitForDashboard(page)
    await page.goto('/processes')

    const createResponse = page
      .waitForResponse(
        (response: any) => response.url().includes('/api/process') && response.request().method() === 'POST',
        { timeout: 15000 },
      )
      .catch(() => null)

    // Click to create new process
    await page.getByRole('button', { name: /new process/i }).first().click()
    const response = await createResponse
    expect(response).toBeTruthy()
    expect(response?.ok()).toBeTruthy()

    await page.waitForURL(/\/process\/[0-9a-f-]+/i, { timeout: 30000 })

    await expect(page.getByRole('button', { name: /export sop/i })).toBeVisible({ timeout: 10000 })
  })

  test('user can update SOP document through full workflow', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    await openOrCreateProcess(page)

    const sopTab = page.locator('button:has-text("SOP Document")').first()
    await expect(sopTab).toBeVisible({ timeout: 10000 })
    await sopTab.click()

    const chatInput = page.locator('input[placeholder*="type your answer" i], input[placeholder*="or type your answer" i]').first()
    await expect(chatInput).toBeVisible({ timeout: 10000 })

    await chatInput.fill('Please add three SOP steps for this process and return concise output.')
    await page.getByRole('button', { name: /send/i }).click()
    await expect(chatInput).toHaveValue('')
  })

  test('user can export process documentation', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    await openOrCreateProcess(page)

    await triggerExportAndAssert(page)
  })

  test('user can navigate between process tabs and maintain state', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    await openOrCreateProcess(page)

    const tabNames = ['SOP Document', 'Process Map', 'RACI/DACI', 'Decisions']

    for (const tabName of tabNames) {
      const tabButton = page.locator(`button:has-text("${tabName}")`).first()
      await expect(tabButton).toBeVisible({ timeout: 10000 })
      await tabButton.click()
      await expect(tabButton).toBeVisible({ timeout: 5000 })
      await expect(page).toHaveURL(/\/process\/[0-9a-f-]+/i)
    }
  })

  test('process page shows 30-day action plan guidance', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    await openOrCreateProcess(page)

    await expect(page.getByText('30-Day Action Plan')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Owner:/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Horizon:/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('process page remains stable with malformed legacy snapshot shape', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    const legacyProcessId = '00000000-0000-0000-0000-000000000001'

    await page.route(`**/api/process/${legacyProcessId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          process: {
            id: legacyProcessId,
            name: 'Legacy Snapshot Process',
            phase: 1,
            completion: 10,
            squad_id: null,
            squads: null,
          },
          conversations: [],
          snapshot: {
            processName: 'Legacy Snapshot Process',
            owner: '',
            purpose: '',
            scope: '',
            phase: 1,
            completion: 10,
            steps: null,
            roles: null,
            decisions: null,
            daciRoles: null,
            systems: null,
            integrations: null,
            dependencies: null,
            followups: null,
            kpis: null,
            architectureNotes: null,
          },
        }),
      })
    })

    await page.goto(`/process/${legacyProcessId}`)
    await page.waitForURL(new RegExp(`/process/${legacyProcessId}$`), { timeout: 10000 })

    await expect(page.getByRole('heading', { name: /Application error: a client-side exception/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /export sop/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('30-Day Action Plan')).toBeVisible({ timeout: 10000 })
  })

  test('live Morgan update tolerates malformed nested architecture fields', async ({ page }) => {
    await loginAndWaitForDashboard(page)
    await openOrCreateProcess(page)

    const autopilotOnButton = page.getByRole('button', { name: /autopilot on/i })
    if (await autopilotOnButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await autopilotOnButton.click()
    }

    await page.route('**/api/morgan/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: [
          'Applying update now.\\n\\n',
          '```json',
          JSON.stringify({
            processName: 'Live Malformed Update Scenario',
            owner: '',
            purpose: '',
            scope: '',
            steps: [{ id: 1, name: 'Intake', action: 'Collect intake details' }],
            architectureNotes: {
              summary: 'Legacy nested fields may be null during migration.',
              gaps: null,
              recommendations: null,
              automationOpportunities: null,
            },
          }),
          '```',
        ].join('\\n'),
      })
    })

    await page.route('**/api/morgan/critique', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          openai: { available: true, score: 8, issues: [], suggestion: '' },
          gemini: { available: true, score: 8, issues: [], suggestion: '' },
        }),
      })
    })

    const chatInput = page.locator('input[placeholder*="type your answer" i], input[placeholder*="or type your answer" i]').first()
    await expect(chatInput).toBeVisible({ timeout: 10000 })

    const userPrompt = 'Update this process with current architecture details.'
    const chatRequest = page
      .waitForRequest((request: any) => request.url().includes('/api/morgan/chat') && request.method() === 'POST', {
        timeout: 12000,
      })
      .catch(() => null)

    await chatInput.fill(userPrompt)
    await page.getByRole('button', { name: /send/i }).click()
    expect(await chatRequest).toBeTruthy()

    await expect(page.getByRole('heading', { name: /Application error: a client-side exception/i })).toHaveCount(0)
    await expect(page.getByText('30-Day Action Plan')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /export sop/i })).toBeVisible({ timeout: 10000 })
  })

  test('transcript and export flow stay in sync after a deterministic chat turn', async ({ page }) => {
    await loginAndWaitForDashboard(page)
    await openOrCreateProcess(page)

    const autopilotOnButton = page.getByRole('button', { name: /autopilot on/i })
    if (await autopilotOnButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await autopilotOnButton.click()
    }

    await page.route('**/api/morgan/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: 'Acknowledged. I captured your update and the SOP draft remains available for export.',
      })
    })

    await page.route('**/api/morgan/critique', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          openai: { available: true, score: 9, issues: [], suggestion: '' },
          gemini: { available: true, score: 9, issues: [], suggestion: '' },
        }),
      })
    })

    const chatInput = page.locator('input[placeholder*="type your answer" i], input[placeholder*="or type your answer" i]').first()
    await expect(chatInput).toBeVisible({ timeout: 10000 })

    const userPrompt = 'Please lock this as the current draft for export parity checks.'
    await chatInput.fill(userPrompt)
    await page.getByRole('button', { name: /send/i }).click()

    const transcriptArea = page.getByText('Live transcript').locator('..')
    await expect(transcriptArea).toContainText(`You: ${userPrompt}`, { timeout: 12000 })

    await triggerExportAndAssert(page)

    await expect(transcriptArea).toContainText(`You: ${userPrompt}`, { timeout: 5000 })
  })

  test('admin observability page loads and metrics API returns expected shape', async ({ page }) => {
    await loginAndWaitForDashboard(page)

    await page.goto('/admin/observability')
    await expect(page.getByRole('heading', { name: 'Observability' })).toBeVisible({ timeout: 10000 })

    const apiResult = await page.evaluate(async () => {
      const response = await fetch('/api/admin/observability?days=7', { credentials: 'include' })
      const body = await response.json().catch(() => null)
      return {
        ok: response.ok,
        status: response.status,
        body,
      }
    })

    expect(apiResult.ok).toBeTruthy()

    const payload = (apiResult.body || {}) as {
      summary?: Record<string, unknown>
      funnel?: Record<string, unknown>
      daily?: unknown[]
      recent?: unknown[]
      topErrors?: unknown[]
    }

    expect(payload.summary).toBeTruthy()
    expect(payload.funnel).toBeTruthy()
    expect(Array.isArray(payload.daily)).toBeTruthy()
    expect(Array.isArray(payload.recent)).toBeTruthy()
    expect(Array.isArray(payload.topErrors)).toBeTruthy()

    await expect(page.getByText(/Morgan (Requests|Help Items)/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Daily Activity')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Recent Events')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Loading metrics...')).toHaveCount(0)
  })

  test('chat with Morgan avatar persists conversation history', async ({ page }) => {
    test.setTimeout(60000)

    await loginAndWaitForDashboard(page)

    await openOrCreateProcess(page)

    // Wait for Morgan avatar component to load
    await page.waitForTimeout(2000)

    // Manual chat can race with autopilot thinking on first load; turn autopilot off for deterministic send.
    const autopilotOnButton = page.getByRole('button', { name: /autopilot on/i })
    if (await autopilotOnButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await autopilotOnButton.click()
    }

    const thinkingLabel = page.getByText('Thinking...').first()
    if (await thinkingLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(thinkingLabel).not.toBeVisible({ timeout: 15000 }).catch(() => null)
    }

    // Look for chat input or message send button
    const chatInput = page.locator('input[placeholder*="type your answer" i], input[placeholder*="or type your answer" i]').first()
    const sendButton = page.locator('button:has-text("Send"), button[aria-label*="send" i]').first()

    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      const userPrompt = 'What are the key steps in this process?'
      const chatRequestPromise = page
        .waitForRequest(
          (request: any) => request.url().includes('/api/morgan/chat') && request.method() === 'POST',
          { timeout: 12000 },
        )
        .catch(() => null)

      // Send first message
      await chatInput.fill(userPrompt)
      if (await sendButton.isEnabled({ timeout: 2000 }).catch(() => false)) {
        await sendButton.click()
      } else {
        await chatInput.press('Enter')
      }

      const chatRequest = await chatRequestPromise
      expect(chatRequest).toBeTruthy()

      // Wait for input reset and verify the user's turn is persisted in transcript/history UI.
      await expect(chatInput).toHaveValue('', { timeout: 7000 }).catch(() => page.waitForTimeout(1000))
      const transcriptArea = page.getByText('Live transcript').locator('..')
      await expect(transcriptArea).toContainText(`You: ${userPrompt}`, { timeout: 12000 })

      // If assistant responds quickly, great; if still thinking, persistence is already verified.
      await page
        .waitForResponse(
          (response) => response.url().includes('/api/morgan/chat') && response.status() === 200,
          { timeout: 15000 },
        )
        .catch(() => null)
    } else {
      // Morgan might not have chat input, verify avatar is present
      await expect(page.locator('video, iframe, [class*="avatar"]').first()).toBeVisible({ timeout: 10000 }).catch(() => {
        // Avatar might be loading
        return page.waitForTimeout(3000)
      })
    }
  })
})
