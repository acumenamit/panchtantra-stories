// The root-file structure scan (Step 6 R9; design p1-step7-design.md §4, §4.1, §4.2, §7 items
// 6-13, §8.1 item 6; P1-1c). The three root files are read as text (they import next/font through
// src/ui/root/font-classes.ts, which only runs inside Next); only the pure document.ts and
// metadata.ts are imported.
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

const BOOT_IMPORT = "import { TEXT_SCALE_BOOT_SCRIPT } from '@/core/progress/text-scale-boot'"
const BOOT_SCRIPT = '<script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_BOOT_SCRIPT }} />'
const REDIRECT_SCRIPT = '<script dangerouslySetInnerHTML={{ __html: LOCALE_REDIRECT_SCRIPT }} />'

/** Every source file under `dir` (relative to the storyboard root). */
function sources(dir: string): string[] {
  const found: string[] = []
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry.name)) {
        found.push(toPosix(relative(storyboard, path)))
      }
    }
  }
  visit(join(storyboard, dir))
  return found.sort()
}

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
    expect(source).toMatch(/<body>\s*<ChoiceRecorder locale=\{code\} \/>\s*\{children\}\s*<\/body>/)
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
    expect(pageFiles).toEqual([
      'app/(reader)/[locale]/(site)/grown-ups/page.tsx',
      'app/(reader)/[locale]/(site)/page.tsx',
    ])
    for (const file of pageFiles) {
      const source = read(file)
      expect(source, file).toContain("export const dynamic = 'force-static'")
      expect(source, file).toContain('export const dynamicParams = false')
    }
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
