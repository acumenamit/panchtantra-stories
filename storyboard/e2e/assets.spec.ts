// Static assets of P1-1b (spec §6.7 Fonts, §6.8 manifest, §9 headers; design §8 E2E 2): the
// favicon, the icon links, the manifest and its icons, the font licences and every font file
// return 200 with the right content type and the four security headers. This closes the guard's
// status-code gap: e2e/fixtures.ts checks origins, not statuses.
// P1-1c (design p1-step7-design.md §8.3): the font-request test reads the Coming-soon placeholder,
// so it is tagged @gated (the gate also shows Hindi).
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { expect, test } from './fixtures'
import { fontFamilies, lockedFonts, servedFontFaces, settleFonts, sha256 } from './page-helpers'
import { expectSecurityHeaders } from './security-headers'

// Design §6, written out here so the test does not read src/ui/manifest.ts.
const MANIFEST = {
  id: '/',
  name: 'Storyboard',
  short_name: 'Storyboard',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0d0a05',
  theme_color: '#0d0a05',
  lang: 'en',
  dir: 'ltr',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
}

/** The media type of a Content-Type header, lower case, without parameters. */
function mediaType(response: APIResponse): string {
  return (response.headers()['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): string {
  expect(bytes.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a')
  expect(bytes.subarray(12, 16).toString('latin1'), 'first chunk').toBe('IHDR')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

/** GETs `url`, checks 200, the media type and the security headers, and returns the response. */
async function expectAsset(
  request: APIRequestContext,
  url: string,
  type: string,
): Promise<APIResponse> {
  const response = await request.get(url)
  expect(response.status(), `${url}: status`).toBe(200)
  expect(mediaType(response), `${url}: content type`).toBe(type)
  expectSecurityHeaders(response.headers(), url)
  return response
}

test('the favicon, icons, manifest and font licences return 200 with type and headers', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const link = async (rel: string) => {
    const tags = page.locator(`link[rel="${rel}"]`)
    await expect(tags, `link rel=${rel}`).toHaveCount(1)
    const href = await tags.getAttribute('href')
    if (!href) throw new Error(`link rel=${rel} has no href`)
    return { href, sizes: await tags.getAttribute('sizes') }
  }

  const favicon = await (await expectAsset(request, '/favicon.ico', 'image/x-icon')).body()
  // ICO header: reserved 0, type 1 (icon), 1 entry, 16x16.
  expect([favicon.readUInt16LE(0), favicon.readUInt16LE(2), favicon.readUInt16LE(4)]).toEqual([
    0, 1, 1,
  ])
  expect([favicon[6], favicon[7]]).toEqual([16, 16])

  const icon = await link('icon')
  expect(icon.sizes).toBe('32x32')
  expect(pngSize(await (await expectAsset(request, icon.href, 'image/png')).body())).toBe('32x32')

  const apple = await link('apple-touch-icon')
  expect(apple.sizes).toBe('180x180')
  const appleBytes = await (await expectAsset(request, apple.href, 'image/png')).body()
  expect(pngSize(appleBytes)).toBe('180x180')

  const manifestLink = await link('manifest')
  expect(manifestLink.href).toBe('/manifest.webmanifest')
  await expectAsset(request, '/manifest.webmanifest', 'application/manifest+json')

  for (const entry of MANIFEST.icons) {
    const bytes = await (await expectAsset(request, entry.src, entry.type)).body()
    expect(pngSize(bytes), entry.src).toBe(entry.sizes)
  }

  for (const name of ['Lora-OFL.txt', 'NotoSansDevanagari-OFL.txt']) {
    const url = `/licenses/fonts/${name}`
    const response = await expectAsset(request, url, 'text/plain')
    expect(response.headers()['content-type'], `${url}: charset`).toMatch(/charset=utf-8/i)
    expect(await response.text(), url).toContain('SIL Open Font License, Version 1.1')
  }
})

test('the manifest equals design §6 and the page links it', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  const response = await request.get('/manifest.webmanifest')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual(MANIFEST)
})

test('every font file is same-origin woff2 with the headers and the locked bytes', async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')
  const origin = new URL(baseURL).origin
  const fontResponses: { url: string; status: number; type: string }[] = []
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'font') return
    fontResponses.push({
      url: response.url(),
      status: response.status(),
      type: (response.headers()['content-type'] ?? '').split(';')[0]?.trim() ?? '',
    })
  })
  await page.goto('/')

  // Every @font-face file: same origin, under /_next/static/media, 200, font/woff2, the headers,
  // and the bytes of a committed file (each locked file exactly once).
  const urls = (await servedFontFaces(page, request)).flatMap((face) => face.urls)
  expect(urls).toHaveLength(5)
  const hashes: string[] = []
  for (const url of urls) {
    expect(url.origin, url.href).toBe(origin)
    expect(url.pathname, url.href).toMatch(/^\/_next\/static\/media\/[^/]+\.woff2$/)
    const response = await expectAsset(request, url.href, 'font/woff2')
    hashes.push(sha256(await response.body()))
  }
  expect(hashes.sort()).toEqual(
    lockedFonts()
      .map((font) => font.sha256)
      .sort(),
  )

  // The fonts the page itself loads, Hindi included (regular and bold), pass the same checks.
  const { devanagari, devanagariLatin } = await fontFamilies(page)
  await page.evaluate(() => {
    // Under <body>, outside <main>: see INJECTION in ./page-helpers.
    for (const tag of ['p', 'h2']) {
      const element = document.createElement(tag)
      element.lang = 'hi'
      element.textContent = 'पञ्चतन्त्र सिखाता है: हिन्दी।'
      document.body.append(element)
    }
  })
  await settleFonts(page)
  await page.waitForFunction(
    (families) =>
      [...document.fonts].filter(
        (face) =>
          families.includes(face.family.replace(/^["']|["']$/g, '')) && face.status === 'loaded',
      ).length === 4,
    [devanagari, devanagariLatin],
  )
  expect(fontResponses.length, 'font responses on the page').toBeGreaterThanOrEqual(5)
  for (const response of fontResponses) {
    expect(new URL(response.url).origin, response.url).toBe(origin)
    expect(new URL(response.url).pathname, response.url).toMatch(
      /^\/_next\/static\/media\/[^/]+\.woff2$/,
    )
    expect(response.status, response.url).toBe(200)
    expect(response.type, response.url).toBe('font/woff2')
  }
})

test(
  '/ requests one font file (Lora), preloads one, and requests no Devanagari file',
  { tag: '@gated' },
  async ({ page, request }) => {
    const fontRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.resourceType() === 'font' || url.pathname.endsWith('.woff2')) {
        fontRequests.push(url.pathname)
      }
    })
    await page.goto('/')
    await settleFonts(page)
    await page.waitForTimeout(500)

    const { lora } = await fontFamilies(page)
    const loraPaths = (await servedFontFaces(page, request))
      .filter((face) => face.family === lora)
      .flatMap((face) => face.urls.map((url) => url.pathname))
    expect(loraPaths).toHaveLength(1)

    expect(fontRequests).toEqual(loraPaths)
    const preloads = page.locator('link[rel="preload"][as="font"]')
    await expect(preloads).toHaveCount(1)
    expect(new URL((await preloads.getAttribute('href')) ?? '', page.url()).pathname).toBe(
      loraPaths[0],
    )
    expect(fontRequests.filter((path) => /devanagari/i.test(path))).toEqual([])
  },
)
