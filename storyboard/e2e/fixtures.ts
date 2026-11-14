// Shared Playwright fixture: every spec imports test and expect from here (spec §10.2 E2E row).
// For each test it records every securitypolicyviolation event (through an init script) and every
// request URL. After the test it fails if any CSP violation happened, or if any request went to an
// origin other than the test server and the media origin. It also fails if the page started a
// worker: the init script cannot listen inside workers, so their CSP violations would go unseen
// (spec §6.8: P1 ships no service worker).
import { test as base, expect, type Page } from '@playwright/test'
import { MEDIA_ORIGIN } from '../src/config/security-headers'

/** What the page reports for one CSP violation. */
interface CspViolation {
  readonly directive: string
  readonly blockedUri: string
  readonly sourceFile: string
  readonly line: number
}

// The page calls this binding for each violation. A binding survives navigations, so a violation
// on a page the test has already left is still counted.
const REPORT_BINDING = '__e2eReportCspViolation'

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'invalid URL'
  }
}

export const test = base.extend<{ securityGuard: void }>({
  securityGuard: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
      const allowedOrigins = new Set([new URL(baseURL).origin, MEDIA_ORIGIN])
      const violations: CspViolation[] = []
      const requestUrls: string[] = []
      const workerUrls: string[] = []

      await context.exposeBinding(REPORT_BINDING, (_source, violation: CspViolation) => {
        violations.push(violation)
      })
      await context.addInitScript((binding) => {
        // Capture on window sees every violation, whether it targets an element, the document or
        // the window, even if page code stops the event.
        window.addEventListener(
          'securitypolicyviolation',
          (event) => {
            const report = (window as unknown as Record<string, unknown>)[binding]
            if (typeof report !== 'function') return
            void report({
              directive: event.effectiveDirective,
              blockedUri: event.blockedURI,
              sourceFile: event.sourceFile,
              line: event.lineNumber,
            })
          },
          { capture: true },
        )
      }, REPORT_BINDING)
      context.on('request', (request) => {
        requestUrls.push(request.url())
      })
      const recordWorkers = (page: Page) => {
        page.on('worker', (worker) => {
          workerUrls.push(worker.url())
        })
      }
      context.pages().forEach(recordWorkers)
      context.on('page', recordWorkers)
      // Service workers are reported to the context (Chromium only).
      context.on('serviceworker', (worker) => {
        workerUrls.push(worker.url())
      })

      await use()

      // Violation events are queued as tasks, so give each open page one more turn to send any
      // that are still waiting. A page that is closing or navigating has nothing left to send.
      for (const page of context.pages()) {
        await page
          .evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
          .catch(() => undefined)
      }

      expect(violations, 'CSP violations reported by the page').toEqual([])
      const outside = requestUrls.filter((url) => !allowedOrigins.has(originOf(url)))
      expect(outside, `requests outside ${[...allowedOrigins].join(' and ')}`).toEqual([])
      expect(
        workerUrls,
        'workers started; this guard cannot see CSP violations inside workers yet',
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
