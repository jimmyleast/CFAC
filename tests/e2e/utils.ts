/**
 * Test utilities and helpers for E2E testing
 */

export class TestHelpers {
  /**
   * Extract error message from various response formats
   */
  static parseErrorMessage(body: any): string {
    if (typeof body === 'string') return body
    if (body?.error) return body.error
    if (body?.message) return body.message
    if (body?.errors?.[0]) {
      const err = body.errors[0]
      return typeof err === 'string' ? err : err.message || 'Unknown error'
    }
    return 'Unknown error'
  }

  /**
   * Check if response indicates successful authentication
   */
  static isAuthenticationSuccessful(status: number): boolean {
    return status === 200 || status === 201 || status === 204
  }

  /**
   * Wait for network idle (no pending requests)
   */
  static async waitForNetworkIdle(page: any, timeout = 5000): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout })
    } catch {
      // Network idle might timeout, that's ok
    }
  }

  /**
   * Get all console errors from page execution
   */
  static async getConsoleErrors(page: any): Promise<string[]> {
    const errors: string[] = []
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })
    return errors
  }

  /**
   * Verify page has no critical JS errors
   */
  static async verifyCriticalErrors(page: any): Promise<boolean> {
    const errors = await page.locator('[role="alert"], .error, [class*="error"]').all()
    const errorTexts = await Promise.all(errors.map((e: any) => e.textContent()))
    // Check for critical errors (not validation messages)
    return !errorTexts.some(text => text?.includes('500') || text?.includes('Fatal') || text?.includes('crashed'))
  }

  /**
   * Generate test data for process creation
   */
  static generateProcessData() {
    return {
      name: `Test Process ${Date.now()}`,
      description: 'Test process created by E2E test',
      tags: ['test', 'e2e'],
      template: 'custom',
    }
  }

  /**
   * Calculate percentage of success from test results
   */
  static calculateSuccessRate(passed: number, total: number): number {
    return total === 0 ? 0 : Math.round((passed / total) * 100)
  }

  /**
   * Check if element is in viewport
   */
  static async isInViewport(element: any): Promise<boolean> {
    return await element.evaluate((el: any) => {
      const rect = el.getBoundingClientRect()
      return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      )
    })
  }
}

export class PerformanceMetrics {
  /**
   * Collect performance metrics from page
   */
  static async collectMetrics(page: any) {
    return await page.evaluate(() => {
      if (!(performance as any).timing) return null

      const timing = (performance as any).timing
      return {
        dns: timing.domainLookupEnd - timing.domainLookupStart,
        tcp: timing.connectEnd - timing.connectStart,
        ttfb: timing.responseStart - timing.requestStart,
        download: timing.responseEnd - timing.responseStart,
        domInteractive: timing.domInteractive - timing.navigationStart,
        domComplete: timing.domComplete - timing.navigationStart,
        loadComplete: timing.loadEventEnd - timing.navigationStart,
      }
    })
  }

  /**
   * Analyze Core Web Vitals
   */
  static async analyzeWebVitals(page: any) {
    return await page.evaluate(() => {
      const vitals: any = {}

      // Largest Contentful Paint
      if ((PerformanceObserver as any)) {
        try {
          const lcp = new (PerformanceObserver as any)((list: any) => {
            const entries = list.getEntries()
            vitals.lcp = entries[entries.length - 1]?.renderTime || entries[entries.length - 1]?.loadTime || 0
          })
          lcp.observe({ entryTypes: ['largest-contentful-paint'] })
        } catch (e) {
          // LCP not supported
        }

        try {
          const fid = new (PerformanceObserver as any)((list: any) => {
            vitals.fid = list.getEntries()[0]?.processingDuration || 0
          })
          fid.observe({ entryTypes: ['first-input'] })
        } catch (e) {
          // FID not supported
        }

        try {
          const cls = new (PerformanceObserver as any)((list: any) => {
            vitals.cls = list.getEntries().reduce((sum: number, entry: any) => sum + (entry as any).value, 0)
          })
          cls.observe({ entryTypes: ['layout-shift'] })
        } catch (e) {
          // CLS not supported
        }
      }

      return vitals
    })
  }
}

export class APIValidator {
  /**
   * Validate response conforms to schema
   */
  static validateResponseSchema(data: any, expectedFields: string[]): { valid: boolean; missing: string[] } {
    const missing = expectedFields.filter(field => !(field in data))
    return {
      valid: missing.length === 0,
      missing,
    }
  }

  /**
   * Check response headers for security best practices
   */
  static validateSecurityHeaders(headers: Record<string, string>): { valid: boolean; issues: string[] } {
    const issues: string[] = []

    if (!headers['x-content-type-options']) {
      issues.push('Missing X-Content-Type-Options header')
    }

    if (!headers['content-security-policy'] && !headers['x-frame-options']) {
      issues.push('Missing CSP or X-Frame-Options header')
    }

    if (!headers['x-xss-protection'] && !headers['content-security-policy']?.includes('script-src')) {
      issues.push('Missing XSS protection headers')
    }

    return {
      valid: issues.length === 0,
      issues,
    }
  }

  /**
   * Validate API response payload size
   */
  static validatePayloadSize(contentLength?: string | null, maxSizeKB = 100): { valid: boolean; sizeKB: number } {
    if (!contentLength) return { valid: true, sizeKB: 0 }

    const sizeKB = parseInt(contentLength, 10) / 1024
    return {
      valid: sizeKB <= maxSizeKB,
      sizeKB,
    }
  }
}

export class AccessibilityValidator {
  /**
   * Check for basic WCAG compliance
   */
  static async checkWCAGCompliance(page: any): Promise<{ issues: string[] }> {
    const issues: string[] = []

    // Check for missing alt text on images
    const imagesWithoutAlt = await page.$$eval(
      'img:not([alt])',
      (els: any[]) => els.length
    ).catch(() => 0)

    if (imagesWithoutAlt > 0) {
      issues.push(`${imagesWithoutAlt} images missing alt text`)
    }

    // Check for heading structure
    const headings = await page.$$eval('h1, h2, h3, h4, h5, h6', (els: any[]) => {
      return els.map(e => ({
        tag: e.tagName,
        text: e.textContent?.substring(0, 50),
      }))
    }).catch(() => [])

    if (headings.length === 0) {
      issues.push('No headings found on page')
    }

    // Check for form labels
    const unlabeledInputs = await page.$$eval(
      'input:not([aria-label]):not([id])',
      (els: any[]) => els.length
    ).catch(() => 0)

    if (unlabeledInputs > 0) {
      issues.push(`${unlabeledInputs} inputs missing labels`)
    }

    return { issues }
  }
}
