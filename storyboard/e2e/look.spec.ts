// The Lantern Night look on the placeholder (spec §6.1 OD-9, §6.6, §6.7; P1-1b, design §8 E2E 1
// and 5): text, colours, the Lora face, head metas, the boot script in the server HTML, both
// text-size-adjust forms in the served CSS, reduced motion, the focus ring, forced colours (Chromium)
// and the layout shift of a late Lora file (Chromium).
import type { Page } from '@playwright/test'
import { TEXT_SCALE_BOOT_SCRIPT } from '../src/core/progress/text-scale-boot'
import { expect, test } from './fixtures'
import {
  focusByKeyboard,
  fontFamilies,
  firstFamily,
  lockedFonts,
  reportedFaces,
  servedCss,
  servedFontFaces,
  settleFonts,
  sha256,
} from './page-helpers'

const AMBER = 'rgb(251, 191, 36)'
const CANVAS = 'rgb(13, 10, 5)'

/** A CSS time in seconds ("0s", ".3s", "300ms", "1e-05s"). */
function seconds(time: string): number {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(ms|s)$/i.exec(time.trim())
  if (!match) throw new Error(`not a CSS time: ${JSON.stringify(time)}`)
  const value = Number(match[1])
  return match[2]?.toLowerCase() === 'ms' ? value / 1000 : value
}

/**
 * Adds two buttons for the focus checks: #e2e-focus-plain with the browser's own button style, and
 * #e2e-focus-bordered with an author border, as every control keeps (design §7 item 20). They go
 * under <body>, outside <main> (see INJECTION in ./page-helpers).
 */
async function addFocusProbes(page: Page): Promise<void> {
  await page.addStyleTag({ content: '#e2e-focus-bordered { border: thin solid transparent; }' })
  await page.evaluate(() => {
    for (const id of ['e2e-focus-plain', 'e2e-focus-bordered']) {
      const button = document.createElement('button')
      button.id = id
      button.type = 'button'
      button.textContent = id
      document.body.append(button)
    }
  })
}

/** The focus ring of the element `selector` names, as computed. */
async function ringOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      focusVisible: element.matches(':focus-visible'),
      width: style.outlineWidth,
      style: style.outlineStyle,
      color: style.outlineColor,
      offset: style.outlineOffset,
      shadow: style.boxShadow,
    }
  })
}

test('the placeholder keeps its text and takes the Lantern Night colours', async ({ page }) => {
  await page.goto('/')
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toHaveText('Storyboard')
  await expect(page.locator('main p')).toHaveText('Coming soon.')
  expect(await page.locator('main p').evaluate((p) => p.textContent)).toBe('Coming soon.')

  const colours = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    h1: getComputedStyle(document.querySelector('h1') as Element).color,
    p: getComputedStyle(document.querySelector('main p') as Element).color,
  }))
  expect(colours).toEqual({ html: CANVAS, h1: 'rgb(254, 243, 199)', p: 'rgb(240, 230, 208)' })

  // Weight synthesis only (a single-weight fallback face still draws bold); never a fake italic.
  const synthesis = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      weight: style.getPropertyValue('font-synthesis-weight'),
      style: style.getPropertyValue('font-synthesis-style'),
    }
  })
  expect(synthesis).toEqual({ weight: 'auto', style: 'none' })
})

test('the h1 is set in the self-hosted Lora face, and it has loaded', async ({ page, request }) => {
  await page.goto('/')
  await settleFonts(page)
  const families = await fontFamilies(page)
  const h1Family = await page
    .locator('h1')
    .evaluate((h1) => getComputedStyle(h1).fontFamily)
    .then(firstFamily)
  expect(h1Family).toBe(families.lora)

  // That family is the committed Lora file, byte for byte.
  const faces = (await servedFontFaces(page, request)).filter(
    (face) => face.family === families.lora,
  )
  expect(faces).toHaveLength(1)
  expect(faces[0]?.urls).toHaveLength(1)
  const fontUrl = faces[0]?.urls[0]
  if (!fontUrl) throw new Error('the Lora @font-face has no url()')
  const bytes = await (await request.get(fontUrl.href)).body()
  const locked = lockedFonts().find((font) => font.file === 'lora-wght.woff2')
  expect(locked, 'lora-wght.woff2 in fonts.lock.json').toBeDefined()
  expect(sha256(bytes)).toBe(locked?.sha256)

  const lora = (await reportedFaces(page)).filter((face) => face.family === families.lora)
  expect(lora.map((face) => face.status)).toEqual(['loaded'])
})

test('the head has the theme colour, dark scheme, default viewport and noindex', async ({
  page,
}) => {
  await page.goto('/')
  const meta = async (name: string) => {
    const tags = page.locator(`meta[name="${name}"]`)
    await expect(tags, `meta ${name}`).toHaveCount(1)
    return tags.getAttribute('content')
  }
  expect(await meta('theme-color')).toBe('#0d0a05')
  expect(await meta('color-scheme')).toBe('dark')
  expect(await meta('viewport')).toBe('width=device-width, initial-scale=1')
  expect(await meta('robots')).toBe('noindex, nofollow')
  expect(await page.locator('html').getAttribute('lang')).toBe('en')
  expect(await page.locator('html').getAttribute('dir')).toBe('ltr')
})

test('the server HTML has no data-text-scale and holds the boot script once in <head>', async ({
  request,
}) => {
  const response = await request.get('/')
  expect(response.status()).toBe(200)
  const html = await response.text()
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0]
  expect(htmlTag, '<html> start tag').toBeDefined()
  expect(htmlTag).not.toContain('data-text-scale')
  const headStart = html.indexOf('<head>')
  const headEnd = html.indexOf('</head>')
  expect(headStart).toBeGreaterThan(-1)
  expect(headEnd).toBeGreaterThan(headStart)
  const head = html.slice(headStart, headEnd)
  expect(head.split(`<script>${TEXT_SCALE_BOOT_SCRIPT}</script>`).length - 1).toBe(1)
  expect(head.split(TEXT_SCALE_BOOT_SCRIPT).length - 1).toBe(1)
})

test('the served CSS keeps both text-size-adjust forms', async ({ page, request, browserName }) => {
  await page.goto('/')
  const css = await servedCss(page, request)
  expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/)
  expect(css).toMatch(/(?:^|[{;\s])text-size-adjust:\s*100%/)

  if (browserName !== 'webkit') return
  const computed = await page.evaluate(() =>
    CSS.supports('-webkit-text-size-adjust', '100%')
      ? getComputedStyle(document.documentElement).getPropertyValue('-webkit-text-size-adjust')
      : null,
  )
  if (computed === null) {
    test.info().annotations.push({
      type: 'info',
      description: 'this WebKit build does not support -webkit-text-size-adjust; served CSS only',
    })
  } else {
    expect(computed).toBe('100%')
  }
})

test('reduced motion zeroes the duration tokens, and the safety net beats unlayered CSS', async ({
  page,
}) => {
  const probe = async () => {
    await page.goto('/')
    await page.addStyleTag({ content: '.e2e-motion-probe { transition: opacity 2s; }' })
    return page.evaluate(() => {
      const element = document.createElement('div')
      element.className = 'e2e-motion-probe'
      document.body.append(element)
      return {
        calm: getComputedStyle(document.documentElement).getPropertyValue('--duration-calm'),
        transition: getComputedStyle(element).transitionDuration,
      }
    })
  }

  // Control: without the preference the token and the injected rule keep their values.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const normal = await probe()
  expect(seconds(normal.calm)).toBeCloseTo(0.3, 6)
  expect(seconds(normal.transition)).toBe(2)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await probe()
  expect(seconds(reduced.calm), `--duration-calm is ${reduced.calm}`).toBe(0)
  expect(seconds(reduced.transition), `transition-duration is ${reduced.transition}`).toBeLessThan(
    0.001,
  )
})

test('keyboard focus draws the amber ring with the canvas halo', async ({ page, browserName }) => {
  await page.goto('/')
  await addFocusProbes(page)
  for (const id of ['e2e-focus-plain', 'e2e-focus-bordered']) {
    await focusByKeyboard(page, browserName, `#${id}`)
    const ring = await ringOf(page, `#${id}`)
    expect(ring, id).toMatchObject({
      focusVisible: true,
      width: '3px',
      style: 'solid',
      color: AMBER,
      offset: '2px',
    })
    if (id === 'e2e-focus-plain' && browserName === 'webkit') {
      // WebKit drops box-shadow on a button that keeps its native appearance (first run,
      // 2026-11-14: "none" for any box-shadow rule); an author border, which every control
      // keeps, restores it. Recorded, not gated; the bordered button carries the halo check.
      test.info().annotations.push({
        type: 'narrowed',
        description: `WebKit native-appearance button: box-shadow ${ring.shadow}; halo checked on the bordered button`,
      })
      continue
    }
    expect(ring.shadow, `${id} halo`).toContain(CANVAS)
  }
})

test('forced colours replace the amber ring (Chromium)', async ({ page, request, browserName }) => {
  test.skip(browserName !== 'chromium', 'forced-colors emulation is checked on Chromium only')
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/')

  // The rule as served (design §7 item 20); the build minifies Highlight to `highlight`.
  const css = await servedCss(page, request)
  const forcedRule =
    /@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{\s*:focus-visible\s*\{([^}]*)\}/i.exec(css)
  expect(forcedRule, 'the forced-colors :focus-visible rule in the served CSS').not.toBeNull()
  expect(forcedRule?.[1]).toMatch(/(?:^|;)\s*outline-color\s*:\s*highlight\s*(?:;|$)/i)
  expect(forcedRule?.[1]).toMatch(/(?:^|;)\s*box-shadow\s*:\s*none\s*(?:;|$)/i)

  // Chromium forces outline-color and drops box-shadow by itself on any element that keeps
  // forced-color-adjust: auto, so the bordered probe alone cannot tell whether base.css's rule
  // is there. #e2e-focus-unforced opts out of that (forced-color-adjust: none), so only base.css
  // can change its ring; #e2e-highlight resolves the Highlight system colour the same way.
  await addFocusProbes(page)
  await page.addStyleTag({
    content:
      '#e2e-focus-unforced { border: thin solid transparent; forced-color-adjust: none; }\n' +
      '#e2e-highlight { color: Highlight; forced-color-adjust: none; }',
  })
  const highlight = await page.evaluate(() => {
    const button = document.createElement('button')
    button.id = 'e2e-focus-unforced'
    button.type = 'button'
    button.textContent = 'e2e-focus-unforced'
    const probe = document.createElement('span')
    probe.id = 'e2e-highlight'
    probe.textContent = 'Highlight'
    document.body.append(button, probe)
    return getComputedStyle(probe).color
  })
  expect(highlight).not.toBe(AMBER)

  for (const id of ['e2e-focus-bordered', 'e2e-focus-unforced']) {
    await focusByKeyboard(page, browserName, `#${id}`)
    const ring = await ringOf(page, `#${id}`)
    expect(ring, id).toMatchObject({
      focusVisible: true,
      width: '3px',
      style: 'solid',
      offset: '2px',
      shadow: 'none',
    })
    expect(ring.color, id).not.toBe(AMBER)
    if (id === 'e2e-focus-unforced') expect(ring.color, `${id} is Highlight`).toBe(highlight)
  }
})

test('a Lora file delayed 1.5 s keeps the layout shift under 0.1 (Chromium)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'the Layout Instability API is Chromium only')
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const shifts: number[] = []
    w['__e2eShifts'] = shifts
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
        if (!shift.hadRecentInput) shifts.push(shift.value)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  let delayed = 0
  await page.route(/\/_next\/static\/media\/lora[^/]*\.woff2$/, async (route) => {
    delayed++
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue().catch(() => undefined)
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const { lora } = await fontFamilies(page)
  await page.waitForFunction(
    (family) =>
      [...document.fonts].some(
        (face) => face.family.replace(/^["']|["']$/g, '') === family && face.status === 'loaded',
      ),
    lora,
    { timeout: 15_000 },
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500)))
      }),
  )
  const measured = await page.evaluate(() => ({
    shifts: (window as unknown as Record<string, unknown>)['__e2eShifts'] as number[],
    firstPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN,
    loraEnd:
      performance
        .getEntriesByType('resource')
        .find((entry) => /\/_next\/static\/media\/lora[^/]*\.woff2$/.test(entry.name))
        ?.toJSON().responseEnd ?? Number.NaN,
  }))
  const cls = measured.shifts.reduce((sum, value) => sum + value, 0)
  console.log(
    `[look] CLS on / with Lora delayed 1.5 s: ${cls.toFixed(6)} (${measured.shifts.length} ` +
      `shifts; first paint ${measured.firstPaint.toFixed(0)} ms, Lora arrived ` +
      `${measured.loraEnd.toFixed(0)} ms)`,
  )
  test.info().annotations.push({ type: 'CLS', description: cls.toFixed(6) })
  expect(delayed, 'the Lora request went through the delay').toBeGreaterThan(0)
  // The page painted in the fallback face before Lora arrived, so the swap was measured.
  expect(measured.firstPaint).toBeLessThan(measured.loraEnd)
  expect(cls).toBeLessThan(0.1)
})
