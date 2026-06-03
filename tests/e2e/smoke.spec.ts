import { expect, test } from '@playwright/test'

test.describe('UHP Ops Agent E2E smoke', () => {
  test('dashboard route redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/auth\/login/, { timeout: 20000 })
    await expect(page.getByText('Ops Agent')).toBeVisible()
    await expect(page.locator('#si-email')).toBeVisible()
    await expect(page.locator('#si-pw')).toBeVisible()
  })

  test('login page sign-up domain validation works', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: 'Sign Up' }).click()

    await page.locator('#su-email').fill('person@gmail.com')
    await page.locator('#su-pw').fill('password123')
    await page.locator('#su-cpw').fill('password123')
    await page.getByRole('button', { name: 'Create Account' }).click()

    await expect(
      page.getByText('Sign-up is restricted to uhp.com and contentforgeai.io email addresses.')
    ).toBeVisible()
  })

  test('forgot password requires an email input', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()

    await expect(
      page.getByText('Enter your email address above, then click reset.')
    ).toBeVisible()
  })
})

test.describe('API auth guard checks', () => {
  test('critical APIs return 401 without auth', async ({ request }) => {
    const me = await request.get('/api/me')
    expect(me.status()).toBe(401)

    const processList = await request.get('/api/process')
    expect(processList.status()).toBe(401)

    const morganToken = await request.post('/api/morgan/token')
    expect(morganToken.status()).toBe(401)

    const morganConfig = await request.get('/api/morgan/config')
    expect(morganConfig.status()).toBe(401)
  })
})
