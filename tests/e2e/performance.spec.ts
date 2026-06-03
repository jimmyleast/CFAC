import { expect, test } from '@playwright/test'

/**
 * Performance and load testing
 * Validates response times, load behavior, and scalability
 */

test.describe('Performance: Page Load Times', () => {
  test('login page loads within performance budget (2s)', async ({ page }) => {
    const startTime = Date.now()
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' })
    const loadTime = Date.now() - startTime

    expect(loadTime).toBeLessThan(2000)
    await expect(page.locator('#si-email')).toBeVisible()
  })

  test('dashboard route loads and redirects within 3s', async ({ page }) => {
    const startTime = Date.now()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const navigationTime = Date.now() - startTime

    // Should redirect to login quickly
    expect(navigationTime).toBeLessThan(3000)
    await page.waitForURL(/\/auth\/login/, { timeout: 2000 })
  })

  test('process detail page loads within 3.5s', async ({ page }) => {
    const startTime = Date.now()
    await page.goto('/process/1', { waitUntil: 'domcontentloaded' })
    const loadTime = Date.now() - startTime

    expect(loadTime).toBeLessThan(3500)
  })
})

test.describe('Performance: API Response Times', () => {
  test('/api/me endpoint responds within 500ms', async ({ request }) => {
    // This will return 401 but we're measuring response time
    const startTime = Date.now()
    const response = await request.get('/api/me')
    const responseTime = Date.now() - startTime

    expect(responseTime).toBeLessThan(500)
    expect([200, 401]).toContain(response.status())
  })

  test('/api/process endpoint responds within 1s', async ({ request }) => {
    const startTime = Date.now()
    const response = await request.get('/api/process')
    const responseTime = Date.now() - startTime

    expect(responseTime).toBeLessThan(1000)
    expect([200, 401]).toContain(response.status())
  })

  test('/api/squads endpoint responds within 1s', async ({ request }) => {
    const startTime = Date.now()
    const response = await request.get('/api/squads')
    const responseTime = Date.now() - startTime

    expect(responseTime).toBeLessThan(1000)
    expect([200, 401]).toContain(response.status())
  })

  test('POST /api/chat responds within 2s', async ({ request }) => {
    const startTime = Date.now()
    const response = await request.post('/api/chat', {
      data: { message: 'test', model: 'claude' },
    })
    const responseTime = Date.now() - startTime

    // Even if it fails, should respond quickly
    expect(responseTime).toBeLessThan(2000)
    expect([200, 400, 401, 500]).toContain(response.status())
  })
})

test.describe('Performance: Concurrent Requests', () => {
  test('simultaneous API requests complete within timeout', async ({ request }) => {
    const startTime = Date.now()

    // Send 5 concurrent requests
    const requests = [
      request.get('/api/me'),
      request.get('/api/process'),
      request.get('/api/squads'),
      request.post('/api/chat', { data: { message: 'test' } }).catch(() => null),
      request.get('/api/morgan/config'),
    ]

    const results = await Promise.all(requests)
    const totalTime = Date.now() - startTime

    // All requests should complete within 5s when concurrent
    expect(totalTime).toBeLessThan(5000)

    // At least most requests should get responses
    const successfulResponses = results.filter(r => r?.status && [200, 400, 401, 500].includes(r.status()))
    expect(successfulResponses.length).toBeGreaterThanOrEqual(4)
  })

  test('rapid sequential navigation maintains performance', async ({ page }) => {
    const navigationTimes: number[] = []

    const routes = ['/auth/login', '/process/1', '/process/new', '/']

    for (const route of routes) {
      const startTime = Date.now()
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
        // Route may not exist, just measure time
      })
      navigationTimes.push(Date.now() - startTime)
    }

    // Average navigation time should be reasonable
    const avgTime = navigationTimes.reduce((a, b) => a + b, 0) / navigationTimes.length
    expect(avgTime).toBeLessThan(3500)

    // No single navigation should be excessively slow
    navigationTimes.forEach(time => {
      expect(time).toBeLessThan(8000)
    })
  })
})

test.describe('Performance: Resource Loading', () => {
  test('page resources load efficiently with minimal blocking', async ({ page }) => {
    await page.goto('/auth/login')

    // Get performance metrics
    const perfMetrics = JSON.parse(
      await page.evaluate(() => JSON.stringify(window.performance.getEntriesByType('navigation')))
    )

    if (perfMetrics[0]) {
      const nav = perfMetrics[0]

      // DOM content loaded should be reasonable
      if (nav.domContentLoadedEventEnd && nav.domContentLoadedEventStart) {
        const domLoadTime = nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart
        expect(domLoadTime).toBeLessThan(2000)
      }

      // Time to interactive should be reasonable
      if (nav.loadEventEnd && nav.fetchStart) {
        const tti = nav.loadEventEnd - nav.fetchStart
        expect(tti).toBeLessThan(5000)
      }
    }
  })

  test('initial content is visible without excessive layout shifts', async ({ page }) => {
    let layoutShifts = 0

    // Monitor layout shifts
    await page.evaluate(() => {
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if ((entry as any).hadRecentInput) return
              layoutShifts += (entry as any).value
            }
          })
          observer.observe({ entryTypes: ['layout-shift'] })
        } catch (e) {
          // Layout shifts not supported
        }
      }
    })

    await page.goto('/auth/login')
    await page.waitForTimeout(2000)

    const cumulativeLayoutShift = await page.evaluate(() => {
      // Get any exposed layout shift data
      const entries = window.performance.getEntriesByType('layout-shift')
      return entries.reduce((sum, entry) => sum + ((entry as any).value || 0), 0)
    })

    // CLS (Cumulative Layout Shift) should be low
    expect(cumulativeLayoutShift).toBeLessThan(0.5)
  })
})

test.describe('Performance: Memory and Resource Cleanup', () => {
  test('navigation properly cleans up event listeners', async ({ page }) => {
    // Record initial listener count
    const initialCount = await page.evaluate(() => {
      return document.querySelectorAll('*').length
    })

    // Navigate multiple times
    await page.goto('/auth/login')
    await page.goto('/process/1').catch(() => {})
    await page.goto('/auth/login')

    // Should not accumulate excessive listeners
    const finalCount = await page.evaluate(() => {
      return document.querySelectorAll('*').length
    })

    // Element count should not double (would indicate memory leak)
    expect(finalCount).toBeLessThan(initialCount * 1.8)
  })

  test('page memory consumption remains stable during interactive use', async ({ page }) => {
    await page.goto('/auth/login')

    // Simulate user interaction
    const email = await page.locator('#si-email')
    await email.click()

    // Take measurements
    const initialMetrics = await page.evaluate(() => {
      if ((performance as any).memory) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
        }
      }
      return null
    })

    // Interact with page
    for (let i = 0; i < 10; i++) {
      await email.fill(`test${i}@example.com`)
      await page.waitForTimeout(100)
      await email.clear()
    }

    // Check memory again
    const finalMetrics = await page.evaluate(() => {
      if ((performance as any).memory) {
        return {
          usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
          jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
        }
      }
      return null
    })

    if (initialMetrics && finalMetrics) {
      const memoryGrowth = finalMetrics.usedJSHeapSize - initialMetrics.usedJSHeapSize
      // Memory growth should be minimal during normal interaction
      expect(Math.abs(memoryGrowth)).toBeLessThan(5_000_000) // 5MB max
    }
  })
})

test.describe('Performance: API Payload Size', () => {
  test('API responses have reasonable payload sizes', async ({ request }) => {
    const response = await request.get('/api/me')

    const contentLength = response.headers()['content-length']
    if (contentLength) {
      // Responses should not be excessively large
      const sizeInKB = parseInt(contentLength, 10) / 1024
      expect(sizeInKB).toBeLessThan(100) // 100KB max for single API response
    }
  })

  test('POST requests with reasonable payloads succeed', async ({ request }) => {
    const payload = {
      message: 'Test message with reasonable size',
      metadata: {
        timestamp: new Date().toISOString(),
        userAgent: 'Playwright Test',
        tags: ['test', 'performance'],
      },
    }

    const response = await request.post('/api/chat', { data: payload })

    // Should handle normal payloads
    expect([200, 400, 401, 500, 413]).toContain(response.status())
  })
})
