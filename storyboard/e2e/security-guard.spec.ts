// Self-test for the shared guard in fixtures.ts (spec §10.2 E2E row: zero CSP violations, no
// requests outside the origin allowlist; P1-1c: no cookies). Each probe below breaks one rule on
// purpose, so the guard must fail it after the test; test.fail() turns that expected failure into a
// pass, and a probe the guard lets through fails the run. Probes never wait without a time limit,
// so a broken rule cannot hide behind a timeout. Every probe stays on this machine: loopback
// addresses only.
// P1-4b (design p1-step10-design.md §9.1 G4, C11, T-e6; Step 10e): the media guard. Without the
// mediaStub option, each way a page can ask the media origin for a picture fails the test: an
// <img>, a <link rel=preload as=image imagesrcset>, a new Image() with srcset, a URL with a query,
// a path in another case, a CSS background-image and a <picture><source srcset>. Each probe first
// routes the media host to an abort of its own, so nothing leaves the machine, and checks that the
// request was really made before it marks the test as expected to fail. With the option, the stub
// serves its listed URLs (on the first navigation too) and aborts every other media URL, each
// exactly as requested (a query, another case, a trailing slash, a percent-encoded character), and
// the guard still fails a media request from another page of the test, one answered by the test's
// own route instead of the stub, and one to a look-alike of the media origin.
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { CONTENT_PUBLIC_BASE, MEDIA_ORIGIN } from '../src/config/security-headers'
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

// ---------------------------------------------------------------------------------------------
// The media guard (design p1-step10-design.md §9.1 G4, C11, T-e6)

const MEDIA_HOST = new URL(MEDIA_ORIGIN).hostname
/** A media URL of the shape the reader builds (the media path rule); no build lists it. */
const PROBE_MEDIA = `${CONTENT_PUBLIC_BASE}/media/e2e-guard-probe/${'0'.repeat(64)}-w768.webp`
/** The staging harness's stub picture: a 34-byte 1×1 lossless WebP. */
const PROBE_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
/** A same-origin page the probes serve themselves (page.route): no app code and no CSP. */
const PROBE_PAGE = '/e2e-media-probe'

/** Runs in the page: an <img> of `url`, added to the body. */
function loadImg(url: string): void {
  const img = document.createElement('img')
  img.alt = ''
  img.src = url
  document.body.append(img)
}

/** Each way a page can ask for a picture, and the URL it asks for (design §9.1 G4). */
const MEDIA_FORMS: readonly {
  readonly name: string
  readonly url: string
  readonly load: (url: string) => void
}[] = [
  { name: 'an <img>', url: PROBE_MEDIA, load: loadImg },
  {
    name: 'a <link rel=preload as=image imagesrcset>',
    url: PROBE_MEDIA,
    load: (url) => {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.setAttribute('imagesrcset', `${url} 768w`)
      link.setAttribute('imagesizes', '100vw')
      document.head.append(link)
    },
  },
  {
    name: 'a new Image() with srcset',
    url: PROBE_MEDIA,
    load: (url) => {
      const img = new Image()
      img.sizes = '100vw'
      img.srcset = `${url} 768w`
      // Kept reachable, so the load is not dropped with the element.
      ;(window as unknown as Record<string, unknown>)['__e2eMediaProbe'] = img
    },
  },
  { name: 'a URL with a query', url: `${PROBE_MEDIA}?v=1`, load: loadImg },
  {
    name: 'a path in another case',
    url: PROBE_MEDIA.replace('/storage/v1/object/public/', '/STORAGE/V1/OBJECT/PUBLIC/'),
    load: loadImg,
  },
  {
    name: 'a CSS background-image',
    url: PROBE_MEDIA,
    load: (url) => {
      const box = document.createElement('div')
      box.style.inlineSize = '16px'
      box.style.blockSize = '16px'
      box.style.backgroundImage = `url("${url}")`
      document.body.append(box)
    },
  },
  {
    name: 'a <picture><source srcset>',
    url: PROBE_MEDIA,
    load: (url) => {
      const picture = document.createElement('picture')
      const source = document.createElement('source')
      source.type = 'image/webp'
      source.srcset = `${url} 768w`
      source.sizes = '100vw'
      const img = document.createElement('img')
      img.alt = ''
      picture.append(source, img)
      document.body.append(picture)
    },
  },
]

/**
 * Routes the media host on `page`, any scheme, port or subdomain, to an abort of the test's own, so
 * no probe request leaves the machine. Registered by the test, it runs before a media stub's route.
 * Returns the URLs it caught.
 */
async function abortMediaHost(page: Page): Promise<string[]> {
  const caught: string[] = []
  await page.route(
    (url) => url.hostname === MEDIA_HOST || url.hostname.endsWith(`.${MEDIA_HOST}`),
    async (route) => {
      caught.push(route.request().url())
      await route.abort().catch(() => undefined)
    },
  )
  return caught
}

/** Serves PROBE_PAGE (no CSP) holding one <img> for each of `urls`. */
async function serveProbePage(page: Page, urls: readonly string[]): Promise<void> {
  const images = urls.map((url) => `<img alt="" src="${url}">`).join('')
  await page.route(
    (url) => url.pathname === PROBE_PAGE,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html lang="en"><head><title>probe</title></head><body>${images}</body></html>`,
      }),
  )
}

test.describe('the media guard fails a test without the media stub that loads', () => {
  for (const form of MEDIA_FORMS) {
    test(form.name, async ({ page }) => {
      const caught = await abortMediaHost(page)
      await page.goto('/')
      await page.evaluate(form.load, form.url)
      // The page really asked for that exact URL; only then is the guard expected to fail the test.
      await expect.poll(() => caught, { timeout: 5000 }).toContain(form.url)
      test.fail()
    })
  }
})

test.describe('the media stub', () => {
  test.use({ mediaStub: { urls: [PROBE_MEDIA], body: PROBE_WEBP, contentType: 'image/webp' } })

  test('serves its listed URL, on the first navigation too', async ({ page }) => {
    const media: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).origin === MEDIA_ORIGIN) media.push(request.url())
    })
    const answer = page.waitForResponse(PROBE_MEDIA, { timeout: 5000 })
    await serveProbePage(page, [PROBE_MEDIA])
    await page.goto(PROBE_PAGE)
    const response = await answer
    expect(response.status(), 'status').toBe(200)
    expect(await response.headerValue('content-type'), 'content type').toBe('image/webp')
    expect((await response.body()).length, 'bytes').toBe(PROBE_WEBP.length)
    const naturalWidth = await page.locator('img').evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      return img.naturalWidth
    })
    expect(naturalWidth, 'the stub picture decoded').toBe(1)
    expect(media, 'media requests').toEqual([PROBE_MEDIA])
  })

  test('aborts every other media URL, each compared exactly as the page requests it', async ({
    page,
  }) => {
    const others = [
      `${CONTENT_PUBLIC_BASE}/media/e2e-guard-probe/${'1'.repeat(64)}-w768.webp`,
      `${PROBE_MEDIA}?v=1`,
      PROBE_MEDIA.replace('/storage/', '/STORAGE/'),
      `${PROBE_MEDIA}/`,
      PROBE_MEDIA.replace('-w768', '%2Dw768'),
    ]
    const failed: string[] = []
    const answered: string[] = []
    page.on('requestfailed', (request) => failed.push(request.url()))
    page.on('response', (response) => {
      if (new URL(response.url()).origin === MEDIA_ORIGIN) answered.push(response.url())
    })
    await page.goto('/')
    const results = await page.evaluate(
      (urls) =>
        Promise.all(
          urls.map(
            (url) =>
              new Promise<string>((resolve) => {
                const img = new Image()
                img.onload = () => resolve('load')
                img.onerror = () => resolve('error')
                img.src = url
              }),
          ),
        ),
      others,
    )
    expect(results, 'each picture failed').toEqual(others.map(() => 'error'))
    await expect.poll(() => [...failed].sort(), { timeout: 5000 }).toEqual([...others].sort())
    expect(answered, 'media responses').toEqual([])
  })

  test('still fails a media request from another page of the test', async ({ page, context }) => {
    await page.goto('/')
    const other = await context.newPage()
    const caught = await abortMediaHost(other)
    await other.goto('/')
    await other.evaluate(loadImg, PROBE_MEDIA)
    await expect.poll(() => caught, { timeout: 5000 }).toContain(PROBE_MEDIA)
    test.fail()
  })

  test("still fails a media request the test's own route answers instead of the stub", async ({
    page,
  }) => {
    // As a route.continue() would, which would send it on to the network: only the stub may answer.
    let answered = 0
    await page.route(
      (url) => url.href === PROBE_MEDIA,
      async (route) => {
        answered++
        await route.fulfill({ status: 200, contentType: 'image/webp', body: PROBE_WEBP })
      },
    )
    await page.goto('/')
    await page.evaluate(loadImg, PROBE_MEDIA)
    await expect.poll(() => answered, { timeout: 5000 }).toBeGreaterThan(0)
    test.fail()
  })

  test('still fails a request to a look-alike of the media origin', async ({ page }) => {
    const lookAlikes = [
      PROBE_MEDIA.replace(`//${MEDIA_HOST}`, `//cdn.${MEDIA_HOST}`),
      PROBE_MEDIA.replace(`//${MEDIA_HOST}`, `//${MEDIA_HOST}:8443`),
    ]
    const caught = await abortMediaHost(page)
    await serveProbePage(page, lookAlikes)
    await page.goto(PROBE_PAGE)
    await expect.poll(() => [...caught].sort(), { timeout: 5000 }).toEqual([...lookAlikes].sort())
    test.fail()
  })
})
