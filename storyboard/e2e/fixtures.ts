// Shared Playwright fixture: every spec imports test and expect from here (spec §10.2 E2E row).
// For each test it records every securitypolicyviolation event (through an init script) and every
// request URL. After the test it fails if any CSP violation happened, or if any request went to an
// origin other than the test server and the media origin. It also fails if the page started a
// worker: the init script cannot listen inside workers, so their CSP violations would go unseen
// (spec §6.8: P1 ships no service worker).
// P1-1c (design p1-step7-design.md §8.3 "Guard", "Leg selection"):
// - The site sets no cookies (spec §9): every same-origin response is recorded and any Set-Cookie
//   header fails the test. It is read with headerValue(), never headers(), which leaves out
//   cookie headers. After the test, the context's cookies for the test server's host must be
//   none (this also catches document.cookie, on both engines; other hosts are not ours).
// - Before any test, each worker GETs /en from the project's baseURL and fails fast unless the
//   status matches E2E_LAUNCH (404 gated, 200 review): outside CI, Playwright reuses whatever
//   server already listens on the port, which may be another build. It also GETs "/" and fails
//   unless the page carries this checkout's build id (.next/BUILD_ID), so an older build of the
//   same leg, or another app on the port, is caught too.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'
import { MEDIA_ORIGIN } from '../src/config/security-headers'
import { EN_STATUS, launchLeg } from './launch-leg'

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

/** True when a cookie stored for `domain` (".example.com" or "example.com") applies to `host`. */
function cookieAppliesTo(domain: string, host: string): boolean {
  const bare = domain.replace(/^\./, '')
  return host === bare || host.endsWith(`.${bare}`)
}

export const test = base.extend<{ securityGuard: void }, { buildIdentity: void }>({
  buildIdentity: [
    // A worker fixture cannot use the test-scoped baseURL, so it reads the project option.
    // Playwright requires the (empty) destructuring pattern as the first parameter.
    async ({}, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
      const leg = launchLeg(process.env.E2E_LAUNCH)
      const origin = new URL(baseURL).origin
      const response = await fetch(new URL('/en', baseURL), { redirect: 'manual' })
      await response.body?.cancel()
      if (response.status !== EN_STATUS[leg]) {
        throw new Error(
          `build identity: GET /en on ${origin} returned ${response.status}, but ` +
            `E2E_LAUNCH=${leg} needs ${EN_STATUS[leg]}. The server there is not a ${leg} build: ` +
            'rebuild for this leg, or stop the other server on the port.',
        )
      }
      const buildId = readFileSync(path.join(__dirname, '..', '.next', 'BUILD_ID'), 'utf8').trim()
      const start = await fetch(new URL('/', baseURL), { redirect: 'manual' })
      const startHtml = await start.text()
      if (buildId === '' || !startHtml.includes(buildId)) {
        throw new Error(
          `build identity: "/" on ${origin} does not carry this checkout's build id ` +
            '(.next/BUILD_ID). The server there is another build: stop it, then run again.',
        )
      }
      await use()
    },
    { scope: 'worker', auto: true },
  ],
  securityGuard: [
    async ({ context, baseURL, javaScriptEnabled }, use) => {
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
      const siteOrigin = new URL(baseURL).origin
      const siteHost = new URL(baseURL).hostname
      const allowedOrigins = new Set([siteOrigin, MEDIA_ORIGIN])
      const violations: CspViolation[] = []
      const requestUrls: string[] = []
      const workerUrls: string[] = []
      // One entry per same-origin response: its URL when it carried a Set-Cookie header, else
      // null. A response whose headers can no longer be read (its page closed) counts as null;
      // the cookie-jar check below still sees any cookie it set.
      const setCookieChecks: Promise<string | null>[] = []

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
      context.on('response', (response) => {
        if (originOf(response.url()) !== siteOrigin) return
        setCookieChecks.push(
          response
            .headerValue('set-cookie')
            .then((value) => (value === null ? null : response.url()))
            .catch(() => null),
        )
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
      // With JavaScript off no page script runs, so nothing can be waiting, and page timers never
      // fire, so the turn would never end.
      if (javaScriptEnabled !== false) {
        for (const page of context.pages()) {
          await page
            .evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
            .catch(() => undefined)
        }
      }

      expect(violations, 'CSP violations reported by the page').toEqual([])
      const outside = requestUrls.filter((url) => !allowedOrigins.has(originOf(url)))
      expect(outside, `requests outside ${[...allowedOrigins].join(' and ')}`).toEqual([])
      expect(
        workerUrls,
        'workers started; this guard cannot see CSP violations inside workers yet',
      ).toEqual([])
      const withSetCookie = (await Promise.all(setCookieChecks)).filter((url) => url !== null)
      expect(withSetCookie, 'same-origin responses with a Set-Cookie header (spec §9)').toEqual([])
      const siteCookies = (await context.cookies())
        .filter((cookie) => cookieAppliesTo(cookie.domain, siteHost))
        .map((cookie) => cookie.name)
      expect(siteCookies, `cookies stored for ${siteHost} (spec §9: no cookies)`).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
