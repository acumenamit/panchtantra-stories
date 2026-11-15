// Self-test for the shared guard in fixtures.ts (spec §10.2 E2E row: zero CSP violations, no
// requests outside the origin allowlist; P1-1c: no cookies). Each probe below breaks one rule on
// purpose, so the guard must fail it after the test; test.fail() turns that expected failure into a
// pass, and a probe the guard lets through fails the run. Probes never wait without a time limit,
// so a broken rule cannot hide behind a timeout. Every probe stays on this machine: loopback
// addresses only.
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Playwright's default test file names.
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/

/** Runs `code` as an inline script, then waits for a CSP violation, or two seconds at most. */
async function runInlineScript(page: Page, code: string): Promise<void> {
  await page.evaluate(
    (source) =>
      new Promise<void>((resolve) => {
        window.addEventListener('securitypolicyviolation', () => resolve(), { once: true })
        setTimeout(resolve, 2000)
        const script = document.createElement('script')
        script.textContent = source
        document.body.append(script)
      }),
    code,
  )
}

test('every test file takes test from ./fixtures, so the guard runs for it', () => {
  const dir = path.dirname(test.info().file)
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) =>
    TEST_FILE.test(name),
  )
  expect(files.length).toBeGreaterThan(0)
  for (const name of files) {
    const source = readFileSync(path.join(dir, name), 'utf8')
    expect(source, `${name} must import test from ./fixtures`).toMatch(
      /^import \{[^}]*\btest\b[^}]*\} from '(\.\.?\/)+fixtures'$/m,
    )
    expect(source, `${name} must not take test from @playwright/test`).not.toMatch(
      /^import \{[^}]*\btest\b[^}]*\} from '@playwright\/test'/m,
    )
  }
})

test.describe('the guard fails a test that', () => {
  test('loads an image from another origin (img-src)', async ({ page }) => {
    test.fail()
    await page.goto('/')
    await runInlineScript(
      page,
      "var img = new Image(); img.src = 'http://127.0.0.2:9/probe.png'; document.body.append(img)",
    )
  })

  test('runs eval from page code (script-src)', async ({ page }) => {
    test.fail()
    await page.goto('/')
    await runInlineScript(page, "setTimeout(function () { try { eval('1') } catch (e) {} }, 0)")
  })

  test('requests another origin', async ({ page, baseURL }) => {
    test.fail()
    if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
    const other = new URL(baseURL)
    other.hostname = '127.0.0.1'
    await page.goto(other.href)
  })

  // P1-1c (design §8.3 "Guard"): the site sets no cookies (spec §9).
  test('sets a cookie from page code (document.cookie)', async ({ page }) => {
    test.fail()
    await page.goto('/')
    await page.evaluate(() => {
      document.cookie = 'e2e-probe=1; path=/'
    })
  })

  // Playwright 1.64.1 stores a fulfilled response's cookie itself and leaves Set-Cookie out of that
  // response's reported headers (both engines), so the cookie-jar check is what fails this probe;
  // the next describe proves the response check.
  test('receives a Set-Cookie header from the site', async ({ page }) => {
    test.fail()
    await page.route(
      (url) => url.pathname === '/',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          headers: { 'set-cookie': 'e2e-probe=1; Path=/' },
          body: '<!doctype html><title>probe</title><p>probe</p>',
        }),
    )
    await page.goto('/')
  })

  // The response check itself (design §8.3 "Guard"). A real loopback server is this probe's site:
  // it sends a cookie for another domain, which the browser refuses to store, so the cookie jar
  // stays empty and the Set-Cookie response check is the only rule left that can fail the test.
  // Both preconditions are checked first; only then is the test marked as expected to fail.
  test.describe('on a real server response', () => {
    const PROBE_COOKIE = 'e2e-probe=1; Domain=e2e-probe.invalid; Path=/'
    test.use({
      // A fixture function; its second parameter is not named use (react-hooks lint).
      baseURL: async ({}, provide) => {
        const server = createServer((_request, response) => {
          response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': PROBE_COOKIE })
          response.end('<!doctype html><title>probe</title><p>probe</p>')
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const { port } = server.address() as AddressInfo
        await provide(`http://127.0.0.1:${port}`)
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      },
    })

    test('receives a Set-Cookie header the browser refuses to store', async ({ page, context }) => {
      const response = await page.goto('/')
      expect(await response?.headerValue('set-cookie'), 'the reported Set-Cookie').toBe(
        PROBE_COOKIE,
      )
      expect(await context.cookies(), 'cookies the browser stored').toEqual([])
      test.fail()
    })
  })

  test('starts a worker', async ({ page }) => {
    test.fail()
    await page.route('**/e2e-probe-worker.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    )
    await page.goto('/')
    await Promise.all([
      page.waitForEvent('worker', { timeout: 5000 }).catch(() => undefined),
      page.evaluate(() => {
        new Worker('/e2e-probe-worker.js')
      }),
    ])
  })
})
