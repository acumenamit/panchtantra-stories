// The src/content reader (design p1-step8-design.md §8, §10.1 reader.test.ts; P1-2b). Each test
// writes a content folder in a temp directory from the committed fixture packages: an absent
// folder is an empty catalogue; lists, featured and params come from build-info and the
// hash-checked packages only, never from snapshot.json; every broken folder fails closed with
// `content reader: …`; media URLs use the committed public base; every source file starts with
// import 'server-only'; the module API is one lazy reader per process over <cwd>/.content.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_PUBLIC_BASE, MEDIA_ORIGIN } from '../config/security-headers'
import type { BuildInfo } from '../core/content/build-info'
import { jcsBytes, toJcs } from '../core/hashing'
import { makePointer, makeSnapshot } from '../core/package/catalogue-build'
import { createContentReader, type ContentReader } from './reader'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const here = dirname(fileURLToPath(import.meta.url))
const storyboardDir = join(here, '../..')
const NOW = '2026-11-15T10:00:00.000Z'
const COMMIT = '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0'
const SNAPSHOT_SHA = 'c'.repeat(64)
/** Not alphabetical, so "build-info order" is proven, not assumed. */
const ORDER = ['two-paths', 'lantern-walk', 'river-stones']

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fixtureText = (storyId: string): string =>
  readFileSync(join(storyboardDir, 'fixtures', 'packages', `${storyId}.json`), 'utf8')

interface Pkg {
  readonly storyId: string
  readonly version: number
  readonly bytes: Uint8Array
  readonly json: Json
}

/** A committed fixture package: its exact bytes, or JCS bytes after `mutate`. */
function fixture(storyId: string, mutate?: (pkg: Json) => void): Pkg {
  const text = fixtureText(storyId)
  const json = JSON.parse(text) as Json
  if (!mutate)
    return { storyId, version: json.version, bytes: new TextEncoder().encode(text), json }
  mutate(json)
  return { storyId: json.storyId, version: json.version, bytes: jcsBytes(json), json }
}

let root = ''
let dir = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'content-reader-'))
  dir = join(root, '.content')
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** The build-info rows for these packages, in this order. */
const rows = (packages: readonly Pkg[]) =>
  packages.map((p) => ({ storyId: p.storyId, version: p.version, packageSha256: sha256(p.bytes) }))

function buildInfo(packages: readonly Pkg[], over: Partial<BuildInfo> = {}): BuildInfo {
  return {
    schemaVersion: '1.0',
    mode: 'fixtures',
    seq: 1,
    pointerPath: 'catalogue/fixtures.json',
    snapshotPath: 'catalogue/snapshots/1.json',
    snapshotSha256: SNAPSHOT_SHA,
    featuredStoryId: null,
    stories: rows(packages),
    excluded: [],
    appVersion: null,
    deploymentId: null,
    deploymentUrl: null,
    builtAt: NOW,
    fetches: [],
    ...over,
  }
}

/** Writes a content folder as the loader does: packages/<id>.json and build-info.json (JCS). */
function writeContent(
  packages: readonly Pkg[],
  over: Partial<BuildInfo> = {},
  target = dir,
): BuildInfo {
  mkdirSync(join(target, 'packages'), { recursive: true })
  for (const p of packages) writeFileSync(join(target, 'packages', `${p.storyId}.json`), p.bytes)
  const info = buildInfo(packages, over)
  writeFileSync(join(target, 'build-info.json'), toJcs(info))
  return info
}

const fixtures = (ids: readonly string[] = ORDER) => ids.map((id) => fixture(id))
const reader = (): ContentReader => createContentReader(dir)

/** Every query of the API except mediaUrl (which reads no content). */
const QUERIES: readonly (readonly [string, (r: ContentReader) => unknown])[] = [
  ['contentLoaded', (r) => r.contentLoaded()],
  ['contentMode', (r) => r.contentMode()],
  ['getBuildInfo', (r) => r.getBuildInfo()],
  ['listStories', (r) => r.listStories()],
  ['listStoriesForLocale', (r) => r.listStoriesForLocale('en')],
  ['featuredStory', (r) => r.featuredStory()],
  ['getStory', (r) => r.getStory('two-paths')],
  ['storyParams', (r) => r.storyParams()],
  ['reportContext', (r) => r.reportContext('two-paths')],
]

/** Every query throws exactly this fail-closed message. */
function expectFailClosed(message: string | RegExp): void {
  for (const [name, query] of QUERIES) {
    expect(() => query(reader()), name).toThrow(message)
  }
}

describe('an absent folder is an empty catalogue', () => {
  it('answers every query with nothing, and creates nothing', () => {
    const r = reader()
    expect(r.contentLoaded()).toBe(false)
    expect(r.contentMode()).toBeNull()
    expect(r.getBuildInfo()).toBeNull()
    expect(r.listStories()).toEqual([])
    expect(r.listStoriesForLocale('en')).toEqual([])
    expect(r.listStoriesForLocale('hi')).toEqual([])
    expect(r.featuredStory()).toBeNull()
    expect(r.getStory('two-paths')).toBeNull()
    expect(r.storyParams()).toEqual([])
    expect(r.reportContext('two-paths')).toBeNull()
    expect(existsSync(dir)).toBe(false)
  })
})

describe('a loaded folder', () => {
  it('lists the built stories in build-info order, with summaries from the packages', () => {
    const packages = fixtures()
    const info = writeContent(packages)
    const r = reader()
    expect(r.contentLoaded()).toBe(true)
    expect(r.contentMode()).toBe('fixtures')
    expect(r.getBuildInfo()).toEqual(info)
    expect(r.listStories().map((s) => s.storyId)).toEqual(ORDER)

    const two = packages[0]!.json
    expect(r.listStories()[0]).toEqual({
      storyId: 'two-paths',
      version: two.version,
      packageSha256: sha256(packages[0]!.bytes),
      addedOn: two.addedOn,
      age: two.age,
      emoji: two.emoji,
      color: two.color,
      locales: two.locales,
      defaultLocale: two.defaultLocale,
      source: two.source,
      aiUse: two.aiUse,
      text: Object.fromEntries(
        (two.locales as string[]).map((l) => {
          const { title, description, theme, duration, book } = two.text[l]
          return [l, { title, description, theme, duration, book }]
        }),
      ),
    })
  })

  it('returns each built story with its strict-parsed package and sha256', () => {
    const packages = fixtures()
    writeContent(packages)
    const r = reader()
    for (const p of packages) {
      const story = r.getStory(p.storyId)
      expect(story?.pkg).toEqual(p.json)
      expect(story?.packageSha256).toBe(sha256(p.bytes))
      expect(story?.summary).toBe(r.listStories().find((s) => s.storyId === p.storyId))
    }
  })

  it('gives null for an id that was not built', () => {
    writeContent(fixtures())
    const r = reader()
    expect(r.getStory('no-such-story')).toBeNull()
    expect(r.reportContext('no-such-story')).toBeNull()
    expect(r.getStory('')).toBeNull()
  })

  it('takes the featured story from build-info only', () => {
    writeContent(fixtures(), { featuredStoryId: 'river-stones' })
    expect(reader().featuredStory()?.storyId).toBe('river-stones')
  })

  it('has no featured story when build-info names none', () => {
    writeContent(fixtures())
    expect(reader().featuredStory()).toBeNull()
  })

  it('reads an empty build (0 stories) as loaded', () => {
    writeContent([])
    const r = reader()
    expect(r.contentLoaded()).toBe(true)
    expect(r.listStories()).toEqual([])
    expect(r.storyParams()).toEqual([])
  })

  it('carries the build mode of a Storage build', () => {
    writeContent(fixtures(), {
      mode: 'staging',
      pointerPath: 'catalogue/staging.json',
      fetches: [
        {
          path: 'catalogue/staging.json',
          status: 200,
          cfCacheStatus: 'MISS',
          age: 0,
          pop: 'BOM',
          sha256: 'a'.repeat(12),
          ms: 5,
        },
      ],
    })
    expect(reader().contentMode()).toBe('staging')
  })
})

describe('snapshot.json is never read', () => {
  it('ignores a snapshot that names an excluded story and a featured id build-info lacks', async () => {
    const packages = fixtures()
    const ghost = fixture('lantern-walk', (pkg) => {
      pkg.storyId = 'ghost-story'
    })
    const snapshot = await makeSnapshot({
      schemaVersion: '1.0',
      seq: 1,
      createdAt: NOW,
      note: 'reader test',
      featuredStoryId: 'ghost-story',
      stories: [...packages, ghost].map((p) => ({
        storyId: p.storyId,
        collectionId: 'panchatantra',
        version: p.version,
        packagePath: `packages/${p.storyId}/${sha256(p.bytes)}.json`,
        packageSha256: sha256(p.bytes),
      })),
    })
    const pointer = await makePointer({
      schemaVersion: '1.0',
      seq: 1,
      snapshotPath: 'catalogue/snapshots/1.json',
      snapshotSha256: snapshot.sha256,
      updatedAt: NOW,
    })
    writeContent(packages, {
      mode: 'production',
      excluded: [{ storyId: 'ghost-story', version: 1, reason: 'approval-missing' }],
      fetches: [
        {
          path: 'catalogue/production.json',
          status: 200,
          cfCacheStatus: null,
          age: null,
          pop: null,
          sha256: null,
          ms: 1,
        },
      ],
    })
    writeFileSync(join(dir, 'snapshot.json'), snapshot.bytes)
    writeFileSync(join(dir, 'pointer.json'), pointer.bytes)
    // Even a package file on disk does not make an excluded story readable.
    writeFileSync(join(dir, 'packages', 'ghost-story.json'), ghost.bytes)

    const r = reader()
    expect(r.listStories().map((s) => s.storyId)).toEqual(ORDER)
    expect(r.featuredStory()).toBeNull()
    expect(r.getStory('ghost-story')).toBeNull()
    expect(r.reportContext('ghost-story')).toBeNull()
    expect(r.storyParams().some((p) => p.storyId === 'ghost-story')).toBe(false)
    expect(r.getBuildInfo()?.excluded).toEqual([
      { storyId: 'ghost-story', version: 1, reason: 'approval-missing' },
    ])
  })

  it('works when snapshot.json and pointer.json cannot be read at all (folders in their place)', () => {
    writeContent(fixtures(), { featuredStoryId: 'lantern-walk' })
    mkdirSync(join(dir, 'snapshot.json'))
    mkdirSync(join(dir, 'pointer.json'))
    const r = reader()
    expect(r.listStories().map((s) => s.storyId)).toEqual(ORDER)
    expect(r.featuredStory()?.storyId).toBe('lantern-walk')
  })
})

describe('fails closed', () => {
  it('when the folder holds no build-info', () => {
    mkdirSync(dir)
    expectFailClosed('content reader: build-info.json is missing')
  })

  it('when the folder is a file', () => {
    writeFileSync(dir, 'not a folder')
    expectFailClosed('content reader: the content folder is a file')
  })

  it('when build-info is not JSON', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'build-info.json'), '{"schemaVersion":')
    expectFailClosed('content reader: build-info.json is not valid UTF-8 JSON')
  })

  it.each([
    ['an unknown key', { extra: 1 }],
    ['a bad mode', { mode: 'preview' }],
    ['a Storage build without fetches', { mode: 'production' }],
  ])('when build-info fails strict parse (%s)', (_name, over) => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'build-info.json'), toJcs({ ...buildInfo(fixtures()), ...over }))
    expectFailClosed(/^content reader: build-info\.json failed strict parse: /)
  })

  it('when build-info names a package that is not there', () => {
    writeContent(fixtures())
    rmSync(join(dir, 'packages'), { recursive: true })
    expectFailClosed('content reader: package two-paths (packages/two-paths.json) is missing')
  })

  it('when a package path is a folder', () => {
    writeContent(fixtures())
    rmSync(join(dir, 'packages', 'lantern-walk.json'))
    mkdirSync(join(dir, 'packages', 'lantern-walk.json'))
    expectFailClosed('content reader: package lantern-walk (packages/lantern-walk.json) is missing')
  })

  it('when one byte of a package changed', () => {
    writeContent(fixtures())
    const path = join(dir, 'packages', 'river-stones.json')
    const bytes = new Uint8Array(readFileSync(path))
    const at = bytes.indexOf('"'.charCodeAt(0), 100)
    bytes[at + 1] = bytes[at + 1] === 0x61 ? 0x62 : 0x61
    writeFileSync(path, bytes)
    expectFailClosed('content reader: package river-stones sha256 does not match build-info.json')
  })

  it('when a package fails strict parse, even with a matching sha256', () => {
    const bad = fixture('two-paths', (pkg) => {
      pkg.unexpected = true
    })
    writeContent([bad, ...fixtures(['lantern-walk'])])
    expectFailClosed(/^content reader: package two-paths failed strict parse: /)
  })

  it('when a package holds a "__proto__" key', () => {
    const text = fixtureText('two-paths').replace('{', '{"__proto__":{},')
    const bad: Pkg = { ...fixture('two-paths'), bytes: new TextEncoder().encode(text) }
    writeContent([bad])
    expectFailClosed('content reader: package two-paths contains a "__proto__" key')
  })

  it('when a package names another story', () => {
    const lantern = fixture('lantern-walk')
    writeContent([{ ...lantern, storyId: 'two-paths' }])
    expectFailClosed(
      'content reader: package two-paths has storyId lantern-walk, but build-info.json names two-paths',
    )
  })

  it('when a package has another version', () => {
    const two = fixture('two-paths')
    writeContent([{ ...two, version: 2 }])
    expectFailClosed('content reader: package two-paths has version 1, but build-info.json names 2')
  })

  it('when build-info lists a story twice', () => {
    const two = fixture('two-paths')
    writeContent([two, two])
    expectFailClosed('content reader: build-info.json lists story two-paths twice')
  })

  it('when build-info features a story it did not build', () => {
    writeContent(fixtures(['two-paths']), { featuredStoryId: 'lantern-walk' })
    expectFailClosed(
      'content reader: build-info.json featuredStoryId lantern-walk names no built story',
    )
  })

  it('tries a failed folder again on the next query', () => {
    mkdirSync(dir)
    const r = reader()
    expect(() => r.listStories()).toThrow('content reader: build-info.json is missing')
    writeContent(fixtures())
    expect(r.listStories().map((s) => s.storyId)).toEqual(ORDER)
  })
})

describe('reads the folder once', () => {
  it('keeps what it read, even if the folder changes or goes away', () => {
    writeContent(fixtures())
    const r = reader()
    const first = r.listStories()
    rmSync(dir, { recursive: true })
    expect(r.contentLoaded()).toBe(true)
    expect(r.listStories()).toEqual(first)
    expect(r.getStory('two-paths')?.packageSha256).toBe(first[0]?.packageSha256)
  })
})

describe('locales', () => {
  /** two-paths in English only; river-stones also in the disabled locale ar. */
  function writeMixed(): void {
    const englishOnly = fixture('two-paths', (pkg) => {
      pkg.locales = ['en']
      delete pkg.text.hi
    })
    const withArabic = fixture('river-stones', (pkg) => {
      pkg.locales = ['en', 'hi', 'ar']
      pkg.text.ar = pkg.text.en
    })
    writeContent([englishOnly, fixture('lantern-walk'), withArabic])
  }

  it('lists the stories whose package locales include the locale, in build-info order', () => {
    writeMixed()
    const r = reader()
    const ids = (locale: 'en' | 'hi' | 'ar') => r.listStoriesForLocale(locale).map((s) => s.storyId)
    expect(ids('en')).toEqual(['two-paths', 'lantern-walk', 'river-stones'])
    expect(ids('hi')).toEqual(['lantern-walk', 'river-stones'])
    expect(ids('ar')).toEqual([]) // disabled, even though river-stones has it
    expect(r.getStory('river-stones')?.summary.locales).toEqual(['en', 'hi', 'ar'])
  })

  it('gives story params for enabled locales ∩ package locales only', () => {
    writeMixed()
    expect(reader().storyParams()).toEqual([
      { locale: 'en', storyId: 'two-paths' },
      { locale: 'en', storyId: 'lantern-walk' },
      { locale: 'en', storyId: 'river-stones' },
      { locale: 'hi', storyId: 'lantern-walk' },
      { locale: 'hi', storyId: 'river-stones' },
    ])
  })
})

describe('reportContext', () => {
  it('gives the story, its package sha256 and the app version build-info records', () => {
    const packages = fixtures()
    writeContent(packages, { appVersion: COMMIT })
    expect(reader().reportContext('lantern-walk')).toEqual({
      storyId: 'lantern-walk',
      packageSha256: sha256(packages[1]!.bytes),
      appVersion: COMMIT,
    })
  })

  it('gives a null app version outside Vercel', () => {
    writeContent(fixtures())
    expect(reader().reportContext('two-paths')?.appVersion).toBeNull()
  })
})

describe('mediaUrl', () => {
  const path = `media/two-paths/${'d'.repeat(64)}-w800.webp`

  it('joins a safe path onto the committed public base, on the CSP media origin', () => {
    const url = reader().mediaUrl(path)
    expect(url).toBe(`${CONTENT_PUBLIC_BASE}/${path}`)
    expect(new URL(url).origin).toBe(MEDIA_ORIGIN)
    expect(new URL(url).href).toBe(url)
  })

  it('reads no content (works with no folder and with a broken one)', () => {
    expect(reader().mediaUrl(path)).toBe(`${CONTENT_PUBLIC_BASE}/${path}`)
    mkdirSync(dir)
    expect(reader().mediaUrl(path)).toBe(`${CONTENT_PUBLIC_BASE}/${path}`)
  })

  it.each([
    '',
    '/media/x.webp',
    'media//x.webp',
    '../media/x.webp',
    'media/../x.webp',
    'media/./x.webp',
    'media/.hidden',
    'media/x.webp?download=1',
    'media/x.webp#frag',
    'media\\x.webp',
    'media/%2e%2e/x.webp',
    'media/a b.webp',
    'https://evil.example/x.webp',
    '//evil.example/x.webp',
    `media/${'x'.repeat(600)}`,
  ])('refuses the unsafe path %j with a TypeError', (unsafe) => {
    expect(() => reader().mediaUrl(unsafe)).toThrow(TypeError)
  })
})

// ---- the server-only fence (design §8: import 'server-only' first in each source file) ----

/** True when the first statement, after comments and blank lines, is `import 'server-only'`. */
function startsServerOnly(source: string): boolean {
  const rest = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
  return /^import\s*(['"])server-only\1\s*;?\s*(?:\n|$)/.test(rest)
}

/** Every non-test .ts or .tsx file under src/content, relative to the storyboard folder. */
function contentSources(): string[] {
  const found: string[] = []
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        found.push(relative(storyboardDir, path).split(sep).join('/'))
      }
    }
  }
  visit(here)
  return found.sort()
}

describe("import 'server-only' is the first statement of every src/content source file", () => {
  it('the scanner reads the first statement only', () => {
    expect(startsServerOnly("import 'server-only'\nexport {}\n")).toBe(true)
    expect(startsServerOnly('// header\n/* note */\n\nimport "server-only";\nexport {}')).toBe(true)
    expect(startsServerOnly("import { x } from './y'\nimport 'server-only'\n")).toBe(false)
    expect(startsServerOnly("// import 'server-only'\nexport {}\n")).toBe(false)
    expect(startsServerOnly("'use client'\nimport 'server-only'\n")).toBe(false)
    expect(startsServerOnly("import 'server-only-not'\n")).toBe(false)
    expect(startsServerOnly("import marker from 'server-only'\n")).toBe(false)
    expect(startsServerOnly('export {}\n')).toBe(false)
  })

  it('holds for index.ts, reader.ts and any later file', () => {
    const files = contentSources()
    expect(files).toEqual(expect.arrayContaining(['src/content/index.ts', 'src/content/reader.ts']))
    const offenders = files.filter(
      (file) => !startsServerOnly(readFileSync(join(storyboardDir, file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

// ---- the module API (src/content/index.ts) ----

describe('src/content: one lazy reader per process over <cwd>/.content', () => {
  const API = [
    'contentLoaded',
    'contentMode',
    'featuredStory',
    'getBuildInfo',
    'getStory',
    'listStories',
    'listStoriesForLocale',
    'mediaUrl',
    'reportContext',
    'storyParams',
  ]

  /** A fresh copy of the module (a new process, as far as its singleton knows), cwd mocked after import. */
  async function freshModule(cwd: string) {
    vi.resetModules()
    const api = await import('./index')
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    return { api, spy }
  }

  it('exports exactly the design §8 functions', async () => {
    const { api } = await freshModule(root)
    expect(Object.keys(api).sort()).toEqual(API)
  })

  it('reads <cwd>/.content on the first query, once, and keeps that reader', async () => {
    const { api, spy } = await freshModule(root)
    // Written after the import: the module reads the folder only when first asked.
    writeContent(fixtures(), { featuredStoryId: 'two-paths', appVersion: COMMIT })
    expect(api.contentLoaded()).toBe(true)
    expect(api.contentMode()).toBe('fixtures')
    expect(api.listStories().map((s) => s.storyId)).toEqual(ORDER)
    expect(api.listStoriesForLocale('hi')).toHaveLength(3)
    expect(api.featuredStory()?.storyId).toBe('two-paths')
    expect(api.getStory('lantern-walk')?.pkg.storyId).toBe('lantern-walk')
    expect(api.storyParams()).toHaveLength(6)
    expect(api.reportContext('river-stones')?.appVersion).toBe(COMMIT)
    expect(api.getBuildInfo()?.stories).toHaveLength(3)

    // Another working folder, or the folder going away, changes nothing: one reader, read once.
    const elsewhere = mkdtempSync(join(tmpdir(), 'content-reader-other-'))
    try {
      spy.mockReturnValue(elsewhere)
      rmSync(dir, { recursive: true })
      expect(api.contentLoaded()).toBe(true)
      expect(api.listStories().map((s) => s.storyId)).toEqual(ORDER)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('is an empty catalogue when <cwd>/.content is absent', async () => {
    const { api } = await freshModule(root)
    expect(api.contentLoaded()).toBe(false)
    expect(api.listStories()).toEqual([])
    expect(api.storyParams()).toEqual([])
    expect(api.mediaUrl('media/a.webp')).toBe(`${CONTENT_PUBLIC_BASE}/media/a.webp`)
  })
})
