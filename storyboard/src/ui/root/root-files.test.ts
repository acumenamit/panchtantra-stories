// The root-file structure scan (Step 6 R9; design p1-step7-design.md §4, §4.1, §4.2, §7 items
// 6-13, §8.1 item 6; P1-1c). The three root files are read as text (they import next/font through
// src/ui/root/font-classes.ts, which only runs inside Next); only the pure document.ts and
// metadata.ts are imported.
// P1-2c (design p1-step9-design.md §3.6 rows 4, 17-20, §5.2, §9 item 4, §10.1): the staging banner
// first in <body> of each root file, the only files that hold its marker, and the robots-file and
// public/ guards (D10-B: no robots.txt, sitemap or other public file without a robots decision).
// P1-4b (design p1-step10-design.md D11-P1, P29, §4.1): the player page in the page list, its
// child-form generateStaticParams, no notFound() and no localized not-found, and its body order.
// P1 Step 12 (design p1-step12-design.md §3.15 N16, A1; test plan T12-22): the story landing joins
// the page list with the player's rules: the child-form generateStaticParams, [] while gated, no
// notFound() (unknown ids are the global bilingual 404), no localized not-found, and a listed story
// that was not built or lacks the locale stops the build with ids only (it never returns null).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getLocaleDef } from '../../core/locales'
import { htmlAttributes } from './document'
import { ROOT_METADATA, ROOT_ROBOTS } from './metadata'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '../../..')
/** A file's text without its whole-line // comments, so prose about <html> or <head> never counts. */
const read = (path: string): string =>
  readFileSync(join(storyboard, path), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
const toPosix = (path: string): string => path.split(sep).join('/')

const GATE_LAYOUT = 'app/(reader)/(gate)/layout.tsx'
const LOCALE_LAYOUT = 'app/(reader)/[locale]/layout.tsx'
const GLOBAL_NOT_FOUND = 'app/global-not-found.tsx'
const ROOT_FILES = [GATE_LAYOUT, LOCALE_LAYOUT, GLOBAL_NOT_FOUND]
/** The Step 10 player page (P1-4b; design p1-step10-design.md D11-P1, P29). */
const PLAYER_PAGE = 'app/(reader)/[locale]/(player)/stories/[storyId]/read/page.tsx'
/** The Step 12 story landing (design p1-step12-design.md §3.15 N16). */
const LANDING_PAGE = 'app/(reader)/[locale]/(site)/stories/[storyId]/page.tsx'

const BOOT_IMPORT = "import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'"
const BOOT_SCRIPT = '<script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />'
const REDIRECT_SCRIPT = '<script dangerouslySetInnerHTML={{ __html: LOCALE_REDIRECT_SCRIPT }} />'

// P1-2c: the staging banner line and its two imports, in each of the three root files.
const BANNER_LINE = '<StagingBanner mode={contentMode()} />'
const BANNER_IMPORTS = [
  "import { contentMode } from '@/content'",
  "import { StagingBanner } from '@/ui/root/staging-banner'",
]
/** The only app/ and src/ files (tests aside) that hold the banner's attribute name. */
const BANNER_SOURCES = ['src/ui/root/staging-banner.tsx', 'src/ui/root/staging.ts']

/** Every file under `dir` (relative to the storyboard root) whose name passes `keep`. */
function files(dir: string, keep: (name: string) => boolean = () => true): string[] {
  const found: string[] = []
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (keep(entry.name)) found.push(toPosix(relative(storyboard, path)))
    }
  }
  visit(join(storyboard, dir))
  return found.sort()
}

/** Every source file under `dir` (relative to the storyboard root). */
const sources = (dir: string): string[] =>
  files(dir, (name) => /\.(ts|tsx|mts|mjs|js|jsx)$/.test(name))

const count = (text: string, part: string): number => text.split(part).length - 1

describe('the three root files (design §4.1)', () => {
  it.each(ROOT_FILES)('%s exists and imports tokens.css, then base.css', (file) => {
    const lines = read(file).split('\n')
    const tokens = lines.indexOf("import '@/ui/styles/tokens.css'")
    const base = lines.indexOf("import '@/ui/styles/base.css'")
    expect(tokens).toBeGreaterThanOrEqual(0)
    expect(base).toBe(tokens + 1)
    expect(lines.filter((line) => /^import '.*\.css'$/.test(line))).toHaveLength(2)
  })

  it.each(ROOT_FILES)('%s exports the shared viewport', (file) => {
    const source = read(file)
    expect(source).toContain("import { ROOT_VIEWPORT } from '@/ui/viewport'")
    expect(source).toContain('export const viewport = ROOT_VIEWPORT')
  })

  it.each(ROOT_FILES)('%s writes <html> once, from htmlAttributes and FONT_CLASSES', (file) => {
    const source = read(file)
    expect(count(source, '<html')).toBe(1)
    expect(source).toMatch(/<html \{\.\.\.htmlAttributes\(getLocaleDef\([^)]*\), FONT_CLASSES\)\}>/)
    expect(source).toContain("import { htmlAttributes } from '@/ui/root/document'")
    expect(source).toContain("import { FONT_CLASSES } from '@/ui/root/font-classes'")
    expect(count(source, '<body>')).toBe(1)
  })

  it.each(ROOT_FILES)('%s has the boot script exactly once, inside <head>', (file) => {
    const source = read(file)
    expect(source).toContain(BOOT_IMPORT)
    expect(count(source, 'TEXT_SCALE_BOOT_SCRIPT')).toBe(2)
    expect(count(source, BOOT_SCRIPT)).toBe(1)
    expect(count(source, '<head>')).toBe(1)
    expect(count(source, '</head>')).toBe(1)
    const head = source.indexOf('<head>')
    const script = source.indexOf(BOOT_SCRIPT)
    const headEnd = source.indexOf('</head>')
    expect(head).toBeLessThan(script)
    expect(script).toBeLessThan(headEnd)
    expect(headEnd).toBeLessThan(source.indexOf('<body>'))
  })

  it.each(ROOT_FILES)('%s writes no <title>, <meta> or robots by hand', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/<title|<meta/)
    expect(source).not.toMatch(/\brobots\s*:/)
  })

  it('"/" and the 404 are English and left to right; [locale] takes the URL locale', () => {
    expect(read(GATE_LAYOUT)).toContain("htmlAttributes(getLocaleDef('en'), FONT_CLASSES)")
    expect(read(GLOBAL_NOT_FOUND)).toContain("htmlAttributes(getLocaleDef('en'), FONT_CLASSES)")
    expect(read(LOCALE_LAYOUT)).toContain('htmlAttributes(getLocaleDef(code), FONT_CLASSES)')
  })

  it('"/" keeps its metadata; [locale] builds it in metadata.ts; the 404 sets the title only', () => {
    expect(read(GATE_LAYOUT)).toContain('export const metadata: Metadata = ROOT_METADATA')
    expect(read(LOCALE_LAYOUT)).toContain("return readerRootMetadata(t('meta.description'))")
    expect(read(GLOBAL_NOT_FOUND)).toContain(
      "export const metadata: Metadata = { title: 'Page not found – Storyboard' }",
    )
  })

  it('only "/" carries the redirect script: after the boot script and only in open builds', () => {
    const gate = read(GATE_LAYOUT)
    expect(gate).toContain('const open = buildLaunch().readerRoutes')
    expect(count(gate, `{open ? ${REDIRECT_SCRIPT} : null}`)).toBe(1)
    expect(gate.indexOf(BOOT_SCRIPT)).toBeLessThan(gate.indexOf(REDIRECT_SCRIPT))
    expect(gate.indexOf(REDIRECT_SCRIPT)).toBeLessThan(gate.indexOf('</head>'))
    for (const file of [LOCALE_LAYOUT, GLOBAL_NOT_FOUND]) {
      expect(read(file)).not.toContain('LOCALE_REDIRECT_SCRIPT')
    }
  })

  it('[locale] is static, its params come from the launch flag, and ChoiceRecorder is in body', () => {
    const source = read(LOCALE_LAYOUT)
    expect(source).toContain("export const dynamic = 'force-static'")
    expect(source).toContain('export const dynamicParams = false')
    expect(source).toContain('return readerLocaleParams(buildLaunch())')
    expect(source).toContain('params: Promise<{ locale: string }>')
    expect(source).toContain('parseEnabledLocale(')
    expect(source).toContain('if (!buildLaunch().readerRoutes || code === undefined) notFound()')
    expect(source).toMatch(
      /<body>\s*<StagingBanner mode=\{contentMode\(\)\} \/>\s*<ChoiceRecorder locale=\{code\} \/>\s*\{children\}\s*<\/body>/,
    )
  })

  it.each(ROOT_FILES)(
    '%s renders the staging banner once, first in <body>, with both imports (P1-2c)',
    (file) => {
      const source = read(file)
      const lines = source.split('\n')
      for (const line of BANNER_IMPORTS) expect(lines).toContain(line)
      expect(count(source, BANNER_LINE)).toBe(1)
      expect(count(source, 'StagingBanner')).toBe(2)
      expect(count(source, 'contentMode')).toBe(2)
      expect(source).toMatch(/<body>\s*<StagingBanner mode=\{contentMode\(\)\} \/>/)
    },
  )

  it('"/" and the 404 hold only the banner and their content in <body> (P1-2c)', () => {
    expect(read(GATE_LAYOUT)).toMatch(
      /<body>\s*<StagingBanner mode=\{contentMode\(\)\} \/>\s*\{children\}\s*<\/body>/,
    )
    expect(read(GLOBAL_NOT_FOUND)).toMatch(
      /<body>\s*<StagingBanner mode=\{contentMode\(\)\} \/>\s*<NotFoundContent \/>\s*<\/body>/,
    )
  })
})

describe('the app/ tree (design §4, §7 items 6, 9-10)', () => {
  const appFiles = sources('app')

  it('only the three root files render <html>', () => {
    expect(appFiles.filter((file) => read(file).includes('<html')).sort()).toEqual(
      [...ROOT_FILES].sort(),
    )
  })

  it('has no app/layout.tsx, app/page.tsx or app/not-found.tsx', () => {
    for (const name of ['layout', 'page', 'not-found']) {
      for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
        expect(existsSync(join(storyboard, `app/${name}.${ext}`)), `app/${name}.${ext}`).toBe(false)
      }
    }
  })

  it('has no proxy or middleware (no request-time code, spec §3.2)', () => {
    for (const dir of ['', 'src/']) {
      for (const name of ['proxy', 'middleware']) {
        for (const ext of ['ts', 'tsx', 'js', 'mjs']) {
          const path = `${dir}${name}.${ext}`
          expect(existsSync(join(storyboard, path)), path).toBe(false)
        }
      }
    }
  })

  it('every page under [locale] sets dynamic and dynamicParams itself', () => {
    const pages = appFiles.filter((file) => file.startsWith('app/(reader)/[locale]/'))
    const pageFiles = pages.filter((file) => /\/page\.tsx$/.test(file))
    expect(pageFiles, '(T12-22 g1) the page list').toEqual([
      PLAYER_PAGE,
      'app/(reader)/[locale]/(site)/grown-ups/page.tsx',
      'app/(reader)/[locale]/(site)/page.tsx',
      LANDING_PAGE,
    ])
    for (const file of pageFiles) {
      const source = read(file)
      expect(source, file).toContain("export const dynamic = 'force-static'")
      expect(source, file).toContain('export const dynamicParams = false')
    }
  })

  it('the player page lists stories in the child form, [] while gated, and never calls notFound() (P1-4b)', () => {
    const source = read(PLAYER_PAGE)
    // Design p1-step10 D11-P29, C1: the top-down child form, one call per [locale] param.
    expect(source).toContain(
      'export function generateStaticParams({ params }: { params: { locale: string } }) {',
    )
    expect(source).toContain('if (!buildLaunch().readerRoutes || code === undefined) return []')
    expect(source).toContain(
      'return listStoriesForLocale(code).map((s) => ({ storyId: s.storyId }))',
    )
    // Unknown ids are the global bilingual 404 through dynamicParams = false, never a localized one.
    expect(source).not.toMatch(/\bnotFound\b/)
    expect(
      files('app/(reader)/[locale]').filter((file) => /\/not-found\.[^/]+$/.test(file)),
    ).toEqual([])
    // The (player) group has no layout: the page renders its own skip link and chrome (D11-P1).
    expect(files('app/(reader)/[locale]/(player)')).toEqual([PLAYER_PAGE])
    // Body order (design §4.1): the skip link, the saved-run hint script, then the boundary.
    const skip = source.indexOf('<SkipLink ')
    const hint = source.indexOf(
      '<script dangerouslySetInnerHTML={{ __html: savedRunHintScript(data.storyId) }} />',
    )
    const boundary = source.indexOf('<PlayerBoundary ')
    expect(skip).toBeGreaterThan(0)
    expect(hint).toBeGreaterThan(skip)
    expect(boundary).toBeGreaterThan(hint)
  })

  it('the story landing lists stories in the child form, [] while gated, never calls notFound() and throws for an unbuilt story (T12-22, Step 12)', () => {
    const source = read(LANDING_PAGE)
    // g2: the player's child form, one call per [locale] param; nothing listed while gated.
    expect
      .soft(source, '(g2) the child-form signature')
      .toContain(
        'export function generateStaticParams({ params }: { params: { locale: string } }) {',
      )
    expect
      .soft(source, '(g2) [] while gated')
      .toContain('if (!buildLaunch().readerRoutes || code === undefined) return []')
    expect
      .soft(source, '(g2) the listed stories')
      .toContain('return listStoriesForLocale(code).map((s) => ({ storyId: s.storyId }))')
    // g3: unknown ids are the global bilingual 404 through dynamicParams = false.
    expect.soft(source, '(g3) no notFound').not.toMatch(/\bnotFound\b/)
    // g4: no localized not-found anywhere under [locale] (a landing one included).
    expect
      .soft(
        files('app/(reader)/[locale]').filter((file) => /\/not-found\.[^/]+$/.test(file)),
        '(g4) no not-found file',
      )
      .toEqual([])
    // g5: a listed story that was not built, or lacks the locale, stops the build (ids only).
    expect
      .soft(source, '(g5) the missing-story branch throws')
      .toMatch(
        /if \(story === null\) throw new Error\(`landing: story \$\{storyId\} was listed but not built`\)/,
      )
    expect
      .soft(source, '(g5) the locale branch throws')
      .toMatch(
        /throw new Error\(`landing: story \$\{storyId\} was listed for \$\{code\} but has no \$\{code\} text`\)/,
      )
    expect.soft(source, '(g5) never returns null').not.toMatch(/return null\b/)
  })

  it('"/" is static and renders Coming soon or the gate from the launch flag', () => {
    const page = read('app/(reader)/(gate)/page.tsx')
    expect(page).toContain("export const dynamic = 'force-static'")
    expect(page).toContain('buildLaunch().readerRoutes ? <LanguageGate /> : <ComingSoon />')
  })

  it('Coming soon is exactly the pre-Step 7 markup, with no class names', () => {
    const source = read('src/ui/gate/coming-soon.tsx').replace(/\s+/g, '')
    expect(source).toContain('<main><h1>{APP_NAME}</h1><p>Comingsoon.</p></main>')
    expect(source).not.toContain('className')
  })

  it('only staging.ts and staging-banner.tsx hold data-staging-banner in app/ and src/ (tests aside; P1-2c)', () => {
    const raw = (path: string): string => readFileSync(join(storyboard, path), 'utf8')
    for (const file of BANNER_SOURCES) expect(raw(file), file).toContain('data-staging-banner')
    const text = (name: string): boolean => /\.(ts|tsx|mts|mjs|js|jsx|css|json)$/.test(name)
    const holders = [...files('app', text), ...files('src', text)]
      .filter((file) => !file.endsWith('.test.ts') && !BANNER_SOURCES.includes(file))
      .filter((file) => raw(file).includes('data-staging-banner'))
    expect(holders).toEqual([])
  })
})

describe('robots and packages (design §3.12 #20, §8.1 item 6)', () => {
  it('no robots key outside src/ui/root/metadata.ts (tests aside)', () => {
    const files = [...sources('app'), ...sources('src')].filter(
      (file) => !file.endsWith('.test.ts') && file !== 'src/ui/root/metadata.ts',
    )
    expect(files.filter((file) => /\brobots\s*:|['"]robots['"]\s*:/.test(read(file)))).toEqual([])
    expect(read('src/ui/root/metadata.ts')).toMatch(/\brobots: ROOT_ROBOTS/)
  })

  it('no next-intl in package.json', () => {
    const pkg = read('package.json')
    expect(pkg).not.toContain('next-intl')
    const { dependencies = {}, devDependencies = {} } = JSON.parse(pkg) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(Object.keys({ ...dependencies, ...devDependencies })).not.toContain('next-intl')
  })
})

describe('robots files and public/ (P1 D10-B; design p1-step9-design.md §3.6 rows 19-20, §5.2; P1-2c)', () => {
  /** public/ holds only these; the loader writes the git-ignored build-info.json in content builds. */
  const PUBLIC_FILE =
    /^public\/(?:favicon\.ico|icons\/[^/]+\.png|licenses\/fonts\/[^/]+\.txt|build-info\.json)$/

  /**
   * A robots or sitemap file, or a Route Handler in a folder of that name (app/robots.txt/route.ts
   * serves /robots.txt), at the app root or inside route groups for robots, anywhere for sitemaps.
   */
  const ROBOTS_PATH = /^app\/(?:\([^/]+\)\/)*robots\.[^/]+(?:\/|$)/
  const SITEMAP_PATH = /\/sitemap\.[^/]+(?:\/|$)/

  it('the robots and sitemap patterns catch files and Route Handler folders', () => {
    for (const path of [
      'app/robots.ts',
      'app/robots.txt',
      'app/robots.txt/route.ts',
      'app/(reader)/robots.txt/route.ts',
    ]) {
      expect(ROBOTS_PATH.test(path), path).toBe(true)
    }
    for (const path of ['app/sitemap.ts', 'app/en/sitemap.xml', 'app/sitemap.xml/route.ts']) {
      expect(SITEMAP_PATH.test(path), path).toBe(true)
    }
    for (const path of [GATE_LAYOUT, LOCALE_LAYOUT, GLOBAL_NOT_FOUND, 'app/robotsx/page.tsx']) {
      expect(ROBOTS_PATH.test(path) || SITEMAP_PATH.test(path), path).toBe(false)
    }
  })

  it('has no app/robots.*, no app/**/sitemap.* and no public/robots.txt', () => {
    const app = files('app')
    expect(app).toEqual(expect.arrayContaining([GATE_LAYOUT, LOCALE_LAYOUT, GLOBAL_NOT_FOUND]))
    expect(app.filter((file) => ROBOTS_PATH.test(file))).toEqual([])
    expect(app.filter((file) => SITEMAP_PATH.test(file))).toEqual([])
    expect(existsSync(join(storyboard, 'public/robots.txt'))).toBe(false)
  })

  it('public/ holds only favicon.ico, icons/*.png, licenses/fonts/*.txt and build-info.json', () => {
    const publicFiles = files('public')
    expect(publicFiles).toContain('public/favicon.ico')
    expect(publicFiles.filter((file) => !PUBLIC_FILE.test(file))).toEqual([])
  })
})

describe('shared root data (design §4.1, §4.2)', () => {
  it('htmlAttributes: en and hi ltr, ar rtl, suppressHydrationWarning true', () => {
    expect(htmlAttributes(getLocaleDef('en'), 'x')).toMatchObject({ lang: 'en', dir: 'ltr' })
    expect(htmlAttributes(getLocaleDef('hi'), 'x')).toMatchObject({ lang: 'hi', dir: 'ltr' })
    expect(htmlAttributes(getLocaleDef('ar'), 'x')).toMatchObject({ lang: 'ar', dir: 'rtl' })
    for (const code of ['en', 'hi', 'ar'] as const) {
      expect(htmlAttributes(getLocaleDef(code), 'x').suppressHydrationWarning).toBe(true)
    }
  })

  it('ROOT_METADATA equals the pre-Step 7 values exactly', () => {
    expect(ROOT_METADATA).toStrictEqual({
      title: 'Storyboard',
      description: 'Interactive stories for children (work in progress).',
      robots: { index: false, follow: false },
    })
    expect(ROOT_METADATA.robots).toBe(ROOT_ROBOTS)
  })
})
