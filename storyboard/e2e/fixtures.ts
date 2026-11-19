// Shared Playwright fixture: every spec imports test and expect from here (spec §10.2 E2E row).
// For each test it records every securitypolicyviolation event (through an init script) and every
// request URL. After the test it fails if any CSP violation happened, or if any request went to an
// origin other than the test server (from Step 10e the media origin only through the media stub,
// below). It also fails if the page started a worker: the init script cannot listen inside
// workers, so their CSP violations would go unseen
// (spec §6.8: P1 ships no service worker).
// P1-1c (design p1-step7-design.md §8.3 "Guard", "Leg selection"):
// - The site sets no cookies (spec §9): every same-origin response is recorded and any Set-Cookie
//   header fails the test. It is read with headerValue(), never headers(), which leaves out
//   cookie headers. After the test, the context's cookies for the test server's host must be
//   none (this also catches document.cookie, on both engines; other hosts are not ours).
// - Before any test, each worker GETs /en from the project's baseURL and fails fast unless the
//   status matches E2E_LAUNCH (404 gated, 200 review and staging): outside CI, Playwright reuses
//   whatever server already listens on the port, which may be another build. It also GETs "/" and
//   fails unless the page carries this checkout's build id (.next/BUILD_ID), so an older build of
//   the same leg, or another app on the port, is caught too.
// P1-2c (design p1-step9-design.md §2, §6.3, R13): the same GET of "/" must hold the staging
// banner's marker exactly when E2E_LAUNCH is staging, so a review build is never tested as the
// staging leg, nor a staging build as the review leg. The marker comes from src/ui/root/staging.ts.
// P1-4b (design p1-step10-design.md §9.1 G4, C11, R7, R30; Step 10e): the media origin is no longer
// on the allowlist. A test that shows pictures opts in with the mediaStub option: before the test
// body runs, so before its first navigation, the page fixture routes every request to MEDIA_ORIGIN
// on that page (page.route, never a context-wide route: routing turns off the HTTP cache, and other
// specs count font requests) and answers it itself: a URL in mediaStub.urls, compared as the exact
// string the page requests, gets mediaStub.body with mediaStub.contentType; any other media URL is
// aborted. Nothing that goes through Playwright's network layer reaches the real media origin. The
// guard then allows a media request only when that stub answered it, so a media request in a test
// without the option fails the test, and so does one from another page of the same test (the stub
// covers its own page only) or one to a look-alike origin. e2e/security-guard.spec.ts proves each
// bypass form.
// P1-5a Step 11 (design p1-step11-design.md §8.3, A29): mediaStub.status (default 200) is the
// status every listed URL is answered with (the narration spec's 402 and 540, REQ:210); unlisted
// URLs are still aborted, never answered with it, and both count as answered by the stub. The two
// claims above hold only on an engine whose media requests go through Playwright's network layer:
// Windows WebKit fetches a detached audio element's src outside it (probe PR-3: no route, no
// request event, a real connection), where neither the stub nor this guard sees the request. So
// every test that sets a real media element's src asks the engine's media answer first and skips
// where it is not routed with no escape (e2e/media-answer.ts mediaAnswerFor; design S10).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test as base, expect, type Page, type Request } from '@playwright/test'
import { MEDIA_ORIGIN } from '../src/config/security-headers'
import { STAGING_BANNER_MARKER } from '../src/ui/root/staging'
import { EN_STATUS, launchLeg, legHasBanner } from './launch-leg'

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

/**
 * A test's stand-in for the media origin (design §9.1 G4): every media request of the test's page is
 * answered here, never by the network.
 */
export interface MediaStub {
  /** The media URLs it serves, each exactly as the page requests it; any other media URL aborts. */
  readonly urls: readonly string[]
  /** What it serves for each of them. */
  readonly body: Uint8Array
  readonly contentType: string
  /** The status every listed URL is answered with (default 200); unlisted URLs still abort. */
  readonly status?: number
}

interface GuardFixtures {
  securityGuard: void
  /** The test's media stub; null (the default) allows no media request at all. */
  mediaStub: MediaStub | null
  /** The media requests the stub answered (fulfilled or aborted), shared by the page and the guard. */
  stubbedMedia: WeakSet<Request>
}

export const test = base.extend<GuardFixtures, { buildIdentity: void }>({
  mediaStub: [null, { option: true }],
  // Its own fixture so the page and the guard of one test share it. The second parameter is not
  // named use (react-hooks lint).
  stubbedMedia: async ({}, provide) => {
    await provide(new WeakSet<Request>())
  },
  // With a media stub, the route is on the page before the test body runs (its first navigation
  // included). The test's own page.route calls run before this one, so a test may hold a media
  // request and then pass it on with route.fallback(); the stub still answers it.
  page: async ({ page, mediaStub, stubbedMedia }, provide) => {
    if (mediaStub !== null) {
      const known = new Set(mediaStub.urls)
      const body = Buffer.from(mediaStub.body)
      await page.route(
        (url) => url.origin === MEDIA_ORIGIN,
        async (route) => {
          const request = route.request()
          stubbedMedia.add(request)
          // A page that is closing or navigating away may drop the request first.
          if (known.has(request.url())) {
            await route
              .fulfill({
                status: mediaStub.status ?? 200,
                contentType: mediaStub.contentType,
                body,
              })
              .catch(() => undefined)
          } else {
            await route.abort().catch(() => undefined)
          }
        },
      )
    }
    await provide(page)
  },
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
      const hasBanner = startHtml.includes(STAGING_BANNER_MARKER)
      if (hasBanner !== legHasBanner(leg)) {
        throw new Error(
          `build identity: "/" on ${origin} ${hasBanner ? 'shows' : 'does not show'} the staging ` +
            `banner, but E2E_LAUNCH=${leg} needs ${legHasBanner(leg) ? 'it' : 'none'}. The ` +
            `server there is not a ${leg} build: rebuild for this leg, or stop the other server.`,
        )
      }
      await use()
    },
    { scope: 'worker', auto: true },
  ],
  securityGuard: [
    async ({ context, baseURL, javaScriptEnabled, mediaStub, stubbedMedia }, use) => {
      if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
      const siteOrigin = new URL(baseURL).origin
      const siteHost = new URL(baseURL).hostname
      const violations: CspViolation[] = []
      const requests: Request[] = []
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
        requests.push(request)
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
      // The site's own origin, and the media origin only for a request the test's media stub
      // answered (design §9.1 G4): never the real media origin.
      const outside = requests
        .filter((request) => {
          const origin = originOf(request.url())
          if (origin === siteOrigin) return false
          return !(origin === MEDIA_ORIGIN && stubbedMedia.has(request))
        })
        .map((request) => request.url())
      const allowed = mediaStub === null ? siteOrigin : `${siteOrigin} and the media stub`
      expect(outside, `requests outside ${allowed}`).toEqual([])
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
