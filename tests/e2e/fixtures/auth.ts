import { test as base, Page } from '@playwright/test'
import path from 'path'

// Fixture for authenticated user sessions
export const test = base.extend<{
  authenticatedPage: Page
}>({
  authenticatedPage: async ({ page }, use) => {
    // Use saved auth state if available, otherwise perform login
    const authFile = path.join(__dirname, '../.auth/user.json')
    
    try {
      // Try to use existing auth state
      await page.context().addInitScript(() => {
        localStorage.clear()
        sessionStorage.clear()
      })
      
      // Attempt to load stored auth context
      const fs = require('fs')
      if (fs.existsSync(authFile)) {
        const authState = JSON.parse(fs.readFileSync(authFile, 'utf-8'))
        if (authState.cookies?.length) {
          await page.context().addCookies(authState.cookies)
        }
        if (authState.origins?.length) {
          await page.context().addInitScript(state => {
            state.origins.forEach((origin: any) => {
              origin.localStorage?.forEach((item: any) => {
                localStorage.setItem(item.name, item.value)
              })
            })
          }, authState)
        }
      }
    } catch (e) {
      // If auth file doesn't exist, tests should handle login or skip
    }

    await use(page)

    // Save auth state for next test run
    try {
      const authState = await page.context().storageState()
      const fs = require('fs')
      const authDir = path.join(__dirname, '../.auth')
      
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true })
      }
      
      fs.writeFileSync(authFile, JSON.stringify(authState, null, 2))
    } catch (e) {
      // Ignore save errors
    }
  },
})

export { expect } from '@playwright/test'
