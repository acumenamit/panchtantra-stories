// The 11 phase-1 packages "through the file source" (design p1-step8-design.md §10.3, §3.1 D9;
// P1-2b). In-process loadContent with a temp root only (§3.4 row 33), never the entry point.
// Proof A (CI): pt/src/stories re-converted in-process (convertLegacyStory + jcsBytes), with the
// public waiver keys of the committed tools/migrate/legacy-waiver-keys.json in each snapshot entry:
//   1. the fixtures file source; 2. the local Storage stub, staging pointer, spec layout;
//   3. the stub, production pointer, one story unapproved; 4. negatives (tampered byte, edited
//   waived node, keys under another rule set); 5. a control run without the keys that must fail.
//   Fixtures runs pass platform 'win32' (R4), so Proof A also runs on Linux CI; so do the stub's
//   staging-pointer runs (P1-2c, design p1-step9-design.md §3.3 A, §10.1: outside a Vercel Preview
//   a staging pointer loads only in GitHub Actions or on Windows). Production runs keep 'linux'.
// Proof B (local only): the real git-ignored phase-1 files and private waiver files. It compares
// derived keys, hashes and counts only, never a whole waiver file, so a failure cannot print a
// private field; it prints counts only. CI skips it: migration-input/ is git-ignored.
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BuildInfo } from '../src/core/content/build-info'
import { checkPackage, type SnapshotEntry } from '../src/core/content/packages'
import { jcsBytes, sha256Hex, toJcs } from '../src/core/hashing'
import type { WaiverKey, WaiverKeys } from '../src/core/package/catalogue'
import { makePointer, makeSnapshot } from '../src/core/package/catalogue-build'
import type { StoryPackageV1 } from '../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../src/core/rules/panchatantra'
import { deriveWaiverKeys, validatePackage, WaiverFile } from '../src/core/validator'
import { convertLegacyStory } from '../tools/migrate/convert'
import { loadLegacyStories } from '../tools/migrate/load-legacy'
import { buildLegacyWaiverKeys, LegacyWaiverKeysFile } from '../tools/migrate/waiver-keys-cli'
import { buildCatalogue, writeCatalogue } from './build-fixtures-catalogue'
import { loadContent, type Env } from './load-content'
import { startStubStorage, type StubStorage } from './testing/stub-storage'

const storyboardDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PT_STORIES = join(storyboardDir, '..', 'pt', 'src', 'stories')
const KEYS_FILE = join(storyboardDir, 'tools', 'migrate', 'legacy-waiver-keys.json')

const NOW = new Date('2026-11-15T10:00:00.000Z')
const APPROVAL = 'a'.repeat(64)
const FEATURED = 'weaver-and-princess'
const UNAPPROVED = 'jackal-and-war-drum'
const RULESET = PANCHATANTRA_RULESET.ref

const FIXTURES_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=fixtures GITHUB_ACTIONS=unset platform=win32'
const STORAGE_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=linux'
const STAGING_ENV_LINE =
  'content: environment VERCEL=unset VERCEL_ENV=unset CONTENT_SOURCE=storage GITHUB_ACTIONS=unset platform=win32'
const FEATURED_LINE = `content: featured story=${FEATURED} dropped (reason=media-incomplete A001=0 A005=16 A006=8); featuredStoryId=null`
const SUMMARY_LINE = /^content: media heads=0 ok=0 failed=0 retried=0 ms=\d+$/

const sha12 = (sha256: string) => sha256.slice(0, 12)
const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** One re-converted legacy story: the package and its exact JCS bytes. */
interface Phase1 {
  readonly storyId: string
  readonly pkg: StoryPackageV1
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly sha256: string
}

/** What a direct publish-mode validator run counts for a package (the oracle for the log line). */
interface Expected {
  readonly warnings: number
  readonly info: number
}

let phase1: Phase1[] = []
let keysByStory = new Map<string, WaiverKeys>()
const expected = new Map<string, Expected>()

async function toPhase1(pkg: StoryPackageV1): Promise<Phase1> {
  const bytes = jcsBytes(pkg)
  return { storyId: pkg.storyId, pkg, bytes, sha256: await sha256Hex(bytes) }
}

beforeAll(async () => {
  const converted = loadLegacyStories(PT_STORIES).map((l) => convertLegacyStory(l.story))
  converted.sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0))
  phase1 = await Promise.all(converted.map(toPhase1))
  const file = LegacyWaiverKeysFile.parse(JSON.parse(readFileSync(KEYS_FILE, 'utf8')))
  keysByStory = new Map(file.stories.map((s) => [s.storyId, s.waivers]))
  for (const { storyId, pkg } of phase1) {
    const report = validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
    const count = (severity: string) => report.findings.filter((f) => f.severity === severity)
    expected.set(storyId, { warnings: count('warn').length, info: count('info').length })
  }
})

// ---- per-test state ----

let roots: string[] = []
let stub: StubStorage | undefined

afterEach(async () => {
  await stub?.close()
  stub = undefined
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'load-content-phase1-'))
  roots.push(root)
  return root
}

interface Run {
  readonly code: number
  readonly root: string
  readonly out: string[]
  readonly errors: string[]
}

async function run(root: string, env: Env, platform: string): Promise<Run> {
  const out: string[] = []
  const errors: string[] = []
  const code = await loadContent({
    env,
    root,
    platform,
    now: () => NOW,
    log: (line) => void out.push(line),
    logError: (line) => void errors.push(line),
    sleep: async () => undefined,
  })
  return { code, root, out, errors }
}

// ---- snapshot entries ----

type Layout = 'fixtures' | 'storage'

interface EntryOptions {
  /** 'committed' (the default): the block of tools/migrate/legacy-waiver-keys.json; 'none': no block. */
  readonly waivers?: 'committed' | 'none'
  /** Replaces every block's ruleSetRef. */
  readonly ruleSetRef?: string
  /** Production: which entries carry a (synthetic) approvalSha256. */
  readonly approved?: (storyId: string) => boolean
}

function entryFor(p: Phase1, layout: Layout, o: EntryOptions = {}): SnapshotEntry {
  const block = keysByStory.get(p.storyId)
  if (!block) throw new Error(`no committed keys for ${p.storyId}`)
  const waivers = o.ruleSetRef ? { ...block, ruleSetRef: o.ruleSetRef } : block
  return {
    storyId: p.storyId,
    collectionId: p.pkg.collectionId,
    version: p.pkg.version,
    packagePath:
      layout === 'fixtures'
        ? `packages/${p.storyId}.json`
        : `packages/${p.storyId}/${p.sha256}.json`,
    packageSha256: p.sha256,
    ...(o.approved?.(p.storyId) ? { approvalSha256: APPROVAL } : {}),
    ...(o.waivers === 'none' ? {} : { waivers }),
  }
}

// ---- the two sources ----

interface Source {
  /** The served packages: each entry's bytes unless `bytes` replaces one story's. */
  readonly packages: readonly Phase1[]
  readonly entries: readonly SnapshotEntry[]
  readonly bytes?: ReadonlyMap<string, Uint8Array>
}

/** Writes the fixtures layout under <root>/fixtures and runs the file source (platform win32). */
async function runFileSource(source: Source): Promise<Run & { readonly dir: string }> {
  const root = tempRoot()
  const dir = join(root, 'fixtures')
  mkdirSync(join(dir, 'packages'), { recursive: true })
  for (const p of source.packages) {
    const bytes = source.bytes?.get(p.storyId) ?? p.bytes
    writeFileSync(join(dir, 'packages', `${p.storyId}.json`), bytes)
  }
  writeCatalogue(dir, await buildCatalogue(source.entries, FEATURED))
  return { ...(await run(root, { CONTENT_SOURCE: 'fixtures' }, 'win32')), dir }
}

interface Published {
  readonly pointerPath: string
  readonly pointerBytes: Uint8Array
  readonly snapshotBytes: Uint8Array
}

/** Serves pointer, snapshot (seq 1) and packages from a fresh stub and runs the Storage loader. */
async function runStub(
  source: Source,
  mode: 'staging' | 'production',
): Promise<Run & Published & { readonly stub: StubStorage }> {
  stub = await startStubStorage()
  const snapshot = await makeSnapshot({
    schemaVersion: '1.0',
    seq: 1,
    createdAt: NOW.toISOString(),
    note: 'phase-1 proof',
    featuredStoryId: FEATURED,
    stories: [...source.entries],
  })
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq: 1,
    snapshotPath: 'catalogue/snapshots/1.json',
    snapshotSha256: snapshot.sha256,
    updatedAt: NOW.toISOString(),
  })
  const pointerPath = `catalogue/${mode}.json`
  stub.put(pointerPath, pointer.bytes, 'application/json')
  stub.put('catalogue/snapshots/1.json', snapshot.bytes, 'application/json')
  for (const [i, p] of source.packages.entries()) {
    const entry = source.entries[i]
    if (!entry) throw new Error('one entry per package')
    stub.put(entry.packagePath, source.bytes?.get(p.storyId) ?? p.bytes, 'application/json')
  }
  const env: Env = {
    CONTENT_SOURCE: 'storage',
    CONTENT_BASE_URL: stub.baseUrl,
    CONTENT_POINTER: pointerPath,
  }
  // A staging pointer loads outside a Preview only in GitHub Actions or on Windows (P1-2c).
  const platform = mode === 'staging' ? 'win32' : 'linux'
  return {
    ...(await run(tempRoot(), env, platform)),
    pointerPath,
    pointerBytes: pointer.bytes,
    snapshotBytes: snapshot.bytes,
    stub,
  }
}

// ---- expected lines ----

const where = (k: Pick<WaiverKey, 'checkId' | 'nodeId' | 'locale'>) =>
  `check=${k.checkId} node=${k.nodeId ?? '-'} locale=${k.locale ?? '-'}`

function keysOf(storyId: string): readonly WaiverKey[] {
  return keysByStory.get(storyId)?.keys ?? []
}

function packageLine(p: Phase1): string {
  const e = expected.get(p.storyId)
  if (!e) throw new Error(`no expectation for ${p.storyId}`)
  return `content: package story=${p.storyId} version=${p.pkg.version} sha=${sha12(p.sha256)} errors=0 waived=${keysOf(p.storyId).length} warnings=${e.warnings} info=${e.info}`
}

const skippedLine = (storyId: string) =>
  `content: validator skipped E016,E017,E018 for story=${storyId} (private word lists not loaded)`

const waivedLines = (storyId: string) =>
  keysOf(storyId).map((k) => `content: waived story=${storyId} ${where(k)}`)

const fetchLine = (path: string, bytes: Uint8Array, seq = '-') =>
  `content: fetch path=${path} status=200 cf=MISS age=0 pop=BOM sha=${sha12(sha256Of(bytes))} seq=${seq}`

const isWaived = (line: string) => line.startsWith('content: waived ')

/**
 * Every waived line sits right after its story's package line, and that block is exactly the
 * story's committed keys (in any order: the log follows the report's order).
 */
function expectWaivedBlocks(out: readonly string[], packages: readonly Phase1[]): void {
  let total = 0
  for (const p of packages) {
    const at = out.indexOf(packageLine(p))
    expect(at, p.storyId).toBeGreaterThan(0)
    const block: string[] = []
    for (let i = at + 1; isWaived(out[i] ?? ''); i++) block.push(out[i] ?? '')
    expect([...block].sort(), p.storyId).toEqual([...waivedLines(p.storyId)].sort())
    total += block.length
  }
  expect(out.filter(isWaived)).toHaveLength(total)
}

function readOutputs(root: string) {
  const content = join(root, '.content')
  const info = BuildInfo.parse(JSON.parse(readFileSync(join(content, 'build-info.json'), 'utf8')))
  const publicCopy = readFileSync(join(root, 'public', 'build-info.json'))
  expect(publicCopy.equals(readFileSync(join(content, 'build-info.json')))).toBe(true)
  const files = readdirSync(join(content, 'packages')).sort()
  const bytes = (storyId: string) =>
    new Uint8Array(readFileSync(join(content, 'packages', `${storyId}.json`)))
  return { info, files, bytes }
}

function expectNoOutputs(root: string): void {
  expect(existsSync(join(root, '.content'))).toBe(false)
  expect(existsSync(join(root, 'public', 'build-info.json'))).toBe(false)
}

const builtRows = (packages: readonly Phase1[]) =>
  packages.map((p) => ({ storyId: p.storyId, version: p.pkg.version, packageSha256: p.sha256 }))

// ---- Proof A (CI) ----

describe('Proof A: the 11 phase-1 packages, re-converted from pt/, with the committed keys', () => {
  it('re-converts 11 stories and finds a committed key block for each, 41 keys in all', () => {
    expect(phase1.map((p) => p.storyId)).toEqual([...keysByStory.keys()].sort())
    expect(phase1).toHaveLength(11)
    expect([...keysByStory.values()].reduce((n, b) => n + b.keys.length, 0)).toBe(41)
    expect([...keysByStory.values()].every((b) => b.ruleSetRef === RULESET)).toBe(true)
  })

  it('without keys 9 of the 11 fail the package gate on their own; with them all 11 pass', async () => {
    const failing: string[] = []
    for (const p of phase1) {
      const bare = await checkPackage(
        p.bytes,
        entryFor(p, 'storage', { waivers: 'none' }),
        PANCHATANTRA_RULESET,
        { requireJcs: true },
      )
      if (!bare.ok) failing.push(p.storyId)
      const keyed = await checkPackage(p.bytes, entryFor(p, 'storage'), PANCHATANTRA_RULESET, {
        requireJcs: true,
      })
      expect(keyed.ok, p.storyId).toBe(true)
    }
    expect(failing).toHaveLength(9)
    expect(phase1.map((p) => p.storyId).filter((id) => !failing.includes(id))).toEqual([
      'jackal-and-war-drum',
      'one-pot-of-seeds',
    ])
    expect(keysOf('jackal-and-war-drum')).toEqual([])
    expect(keysOf('one-pot-of-seeds')).toEqual([])
  })

  it('finds exactly one T006 warning in all 11 packages: crow-and-serpent seek_advice hi', () => {
    const hits = phase1.flatMap(({ pkg }) =>
      validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
        .findings.filter((f) => f.checkId === 'T006')
        .map((f) => [pkg.storyId, f.nodeId, f.locale, f.severity, f.waived === true]),
    )
    expect(hits).toEqual([['crow-and-serpent', 'seek_advice', 'hi', 'warn', false]])
  })

  it('1. the file source builds all 11 with 41 waived findings, 0 unused keys, featured dropped', async () => {
    const entries = phase1.map((p) => entryFor(p, 'fixtures'))
    const r = await runFileSource({ packages: phase1, entries })
    expect(r.errors).toEqual([])
    expect(r.code).toBe(0)

    const sha = (path: string) => sha12(sha256Of(readFileSync(join(r.dir, ...path.split('/')))))
    expect(r.out.filter((line) => !isWaived(line))).toEqual([
      FIXTURES_ENV_LINE,
      `content: read path=catalogue/fixtures.json sha=${sha('catalogue/fixtures.json')} seq=1`,
      `content: read path=catalogue/snapshots/1.json sha=${sha('catalogue/snapshots/1.json')} seq=1`,
      ...phase1.flatMap((p) => [
        `content: read path=packages/${p.storyId}.json sha=${sha12(p.sha256)} seq=-`,
        packageLine(p),
        skippedLine(p.storyId),
      ]),
      FEATURED_LINE,
      'content: mode=fixtures seq=1 snapshot=catalogue/snapshots/1.json stories=11 excluded=0 featured=none',
    ])
    expectWaivedBlocks(r.out, phase1)
    expect(r.out.filter(isWaived)).toHaveLength(41)
    expect(r.out.filter((line) => line.startsWith('content: waiver key unused'))).toEqual([])
    expect(r.out.filter((line) => line.startsWith('content: media'))).toEqual([])
    // The crow package line counts the T006 warning (the oracle's warnings include it).
    const crow = phase1.find((p) => p.storyId === 'crow-and-serpent')
    expect(crow && r.out.includes(packageLine(crow))).toBe(true)

    const outputs = readOutputs(r.root)
    expect(outputs.files).toEqual(phase1.map((p) => `${p.storyId}.json`))
    for (const p of phase1) expect(outputs.bytes(p.storyId), p.storyId).toEqual(p.bytes)
    expect(outputs.info).toMatchObject({
      mode: 'fixtures',
      seq: 1,
      featuredStoryId: null,
      stories: builtRows(phase1),
      excluded: [],
      fetches: [],
    })
  })

  it('2. the stub, staging pointer, spec layout: the same outputs, 13 GETs and 0 HEADs', async () => {
    const file = await runFileSource({
      packages: phase1,
      entries: phase1.map((p) => entryFor(p, 'fixtures')),
    })
    expect(file.code).toBe(0)

    const entries = phase1.map((p) => entryFor(p, 'storage'))
    const r = await runStub({ packages: phase1, entries }, 'staging')
    expect(r.errors).toEqual([])
    expect(r.code).toBe(0)
    expect(r.stub.requests.map((q) => [q.method, q.path])).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ...entries.map((e) => ['GET', e.packagePath]),
    ])
    expect(r.stub.requests).toHaveLength(13)
    expect(r.stub.requests.filter((q) => q.method === 'HEAD')).toEqual([])

    expect(r.out.filter((line) => !isWaived(line))).toEqual([
      STAGING_ENV_LINE,
      fetchLine('catalogue/staging.json', r.pointerBytes, '1'),
      fetchLine('catalogue/snapshots/1.json', r.snapshotBytes, '1'),
      ...phase1.flatMap((p, i) => [
        fetchLine(entries[i]?.packagePath ?? '', p.bytes),
        packageLine(p),
        skippedLine(p.storyId),
      ]),
      ...phase1.map((p) => `content: media story=${p.storyId} variants=0 bytes=0 ok`),
      expect.stringMatching(SUMMARY_LINE),
      FEATURED_LINE,
      'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=11 excluded=0 featured=none',
    ])
    expectWaivedBlocks(r.out, phase1)
    expect(r.out.filter(isWaived)).toHaveLength(41)
    expect(r.out.filter((line) => line.startsWith('content: waiver key unused'))).toEqual([])

    // Identical packages, and build-info identical except mode, paths, snapshotSha256, fetches
    // and builtAt.
    const fromFile = readOutputs(file.root)
    const fromStub = readOutputs(r.root)
    expect(fromStub.files).toEqual(fromFile.files)
    for (const p of phase1) expect(fromStub.bytes(p.storyId)).toEqual(fromFile.bytes(p.storyId))
    const varying = ['mode', 'pointerPath', 'snapshotPath', 'snapshotSha256', 'fetches', 'builtAt']
    const rest = (info: BuildInfo) =>
      Object.fromEntries(Object.entries(info).filter(([key]) => !varying.includes(key)))
    expect(Object.keys(rest(fromFile.info)).sort()).toEqual([
      'appVersion',
      'deploymentId',
      'deploymentUrl',
      'excluded',
      'featuredStoryId',
      'schemaVersion',
      'seq',
      'stories',
    ])
    expect(rest(fromStub.info)).toEqual(rest(fromFile.info))
    expect(fromStub.info.mode).toBe('staging')
    expect(fromStub.info.stories).toEqual(builtRows(phase1))
    expect(fromStub.info.fetches.map((f) => [f.path, f.status])).toEqual(
      r.stub.requests.map((q) => [q.path, 200]),
    )
  })

  it(`3. the stub, production pointer: 10 approved built, ${UNAPPROVED} excluded and never requested`, async () => {
    const approved = (storyId: string) => storyId !== UNAPPROVED
    const entries = phase1.map((p) => entryFor(p, 'storage', { approved }))
    const r = await runStub({ packages: phase1, entries }, 'production')
    expect(r.errors).toEqual([])
    expect(r.code).toBe(0)
    const built = phase1.filter((p) => approved(p.storyId))
    expect(built).toHaveLength(10)
    expect(r.stub.requests.map((q) => [q.method, q.path])).toEqual([
      ['GET', 'catalogue/production.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ...entries.filter((e) => approved(e.storyId)).map((e) => ['GET', e.packagePath]),
    ])
    expect(r.stub.requests.some((q) => q.path.includes(UNAPPROVED))).toBe(false)

    expect(r.out.filter((line) => !isWaived(line))).toEqual([
      STORAGE_ENV_LINE,
      fetchLine('catalogue/production.json', r.pointerBytes, '1'),
      fetchLine('catalogue/snapshots/1.json', r.snapshotBytes, '1'),
      `content: excluded story=${UNAPPROVED} version=1 reason=approval-missing`,
      ...built.flatMap((p) => [
        fetchLine(`packages/${p.storyId}/${p.sha256}.json`, p.bytes),
        packageLine(p),
        skippedLine(p.storyId),
      ]),
      ...built.map((p) => `content: media story=${p.storyId} variants=0 bytes=0 ok`),
      expect.stringMatching(SUMMARY_LINE),
      FEATURED_LINE,
      'content: mode=production seq=1 snapshot=catalogue/snapshots/1.json stories=10 excluded=1 featured=none',
    ])
    expectWaivedBlocks(r.out, built)

    const outputs = readOutputs(r.root)
    expect(outputs.files).toEqual(built.map((p) => `${p.storyId}.json`))
    expect(outputs.info).toMatchObject({
      mode: 'production',
      featuredStoryId: null,
      stories: builtRows(built),
      excluded: [{ storyId: UNAPPROVED, version: 1, reason: 'approval-missing' }],
    })
  })

  // ---- 4 and 5: negatives and the control, through both sources ----

  const SOURCES = ['file source', 'stub storage'] as const
  type SourceName = (typeof SOURCES)[number]

  /** Runs one source; for the stub, also checks the GETs stopped at `lastStoryId`'s package. */
  async function runNegative(name: SourceName, source: Source, lastStoryId: string): Promise<Run> {
    if (name === 'file source') return runFileSource(source)
    const r = await runStub(source, 'staging')
    const upTo = source.entries.findIndex((e) => e.storyId === lastStoryId)
    expect(upTo).toBeGreaterThanOrEqual(0)
    expect(r.stub.requests.map((q) => [q.method, q.path])).toEqual([
      ['GET', 'catalogue/staging.json'],
      ['GET', 'catalogue/snapshots/1.json'],
      ...source.entries.slice(0, upTo + 1).map((e) => ['GET', e.packagePath]),
    ])
    return r
  }

  const layoutOf = (name: SourceName): Layout => (name === 'file source' ? 'fixtures' : 'storage')

  it.each(SOURCES)(
    '4a. %s: one tampered byte fails with a sha256 mismatch and no outputs',
    async (name) => {
      const target = 'crow-and-serpent'
      const original = phase1.find((p) => p.storyId === target)
      if (!original) throw new Error('crow-and-serpent is missing')
      const tampered = new Uint8Array(original.bytes)
      const at = tampered.indexOf('"'.charCodeAt(0), 200) + 1
      tampered[at] = tampered[at] === 0x61 ? 0x62 : 0x61
      expect(sha256Of(tampered)).not.toBe(original.sha256)
      const entries = phase1.map((p) => entryFor(p, layoutOf(name)))
      const r = await runNegative(
        name,
        { packages: phase1, entries, bytes: new Map([[target, tampered]]) },
        target,
      )
      expect(r.code).toBe(1)
      expect(r.errors).toEqual([`content gate failed: package ${target} sha256 mismatch`])
      expect(r.out.some((line) => line.startsWith('content: mode='))).toBe(false)
      expectNoOutputs(r.root)
    },
  )

  it.each(SOURCES)(
    '4b. %s: an edited waived node, re-hashed, fails with the lapsed hint and no outputs',
    async (name) => {
      const target = 'tortoise-and-geese'
      // A committed key binds this node's English text (start: not an ending, so no teaching
      // block); the edit keeps the node too long.
      expect(keysOf(target).map(where)).toContain('check=E004 node=start locale=en')
      const edited = structuredClone(phase1.find((p) => p.storyId === target)?.pkg)
      const node = edited?.text.en?.nodes.start
      if (!edited || !node) throw new Error('tortoise-and-geese start en is missing')
      node.text = `${node.text} And again.`
      const changed = await toPhase1(edited)
      const packages = phase1.map((p) => (p.storyId === target ? changed : p))
      const entries = packages.map((p) => entryFor(p, layoutOf(name)))
      const r = await runNegative(name, { packages, entries }, target)
      expect(r.code).toBe(1)
      expect(r.errors).toEqual([
        `content: unwaived story=${target} check=E004 node=start locale=en: Node text is too long (lapsed: a key for this check, node and locale binds other text)`,
        `content gate failed: package ${target} failed the validator with 1 unwaived error(s); first: E004 node=start locale=en: Node text is too long`,
      ])
      expectNoOutputs(r.root)
    },
  )

  it.each(SOURCES)(
    '4c. %s: keys recorded under panchatantra@3.1.0 fail with the rule-set message and no outputs',
    async (name) => {
      const entries = phase1.map((p) =>
        entryFor(p, layoutOf(name), { ruleSetRef: 'panchatantra@3.1.0' }),
      )
      const r = await runNegative(name, { packages: phase1, entries }, 'blue-jackal')
      expect(r.code).toBe(1)
      expect(r.errors).toEqual([
        `content gate failed: waiver keys for blue-jackal were recorded for panchatantra@3.1.0; this build validates with ${RULESET}`,
      ])
      expectNoOutputs(r.root)
    },
  )

  it.each(SOURCES)(
    '5. control, %s: the same inputs without any waivers block fail on blue-jackal and leave no outputs',
    async (name) => {
      const entries = phase1.map((p) => entryFor(p, layoutOf(name), { waivers: 'none' }))
      expect(entries.every((e) => e.waivers === undefined)).toBe(true)
      const r = await runNegative(name, { packages: phase1, entries }, 'blue-jackal')
      expect(r.code).toBe(1)
      const nodes = keysOf('blue-jackal').map((k) => k.nodeId)
      expect(nodes).toHaveLength(3)
      const details = r.errors.slice(0, -1)
      expect([...details].sort()).toEqual(
        nodes
          .map(
            (n) =>
              `content: unwaived story=blue-jackal check=E010 node=${n} locale=-: Both fork choices lead to the same node`,
          )
          .sort(),
      )
      expect(r.errors.at(-1)).toMatch(
        /^content gate failed: package blue-jackal failed the validator with 3 unwaived error\(s\); first: E010 node=[a-z_]+: Both fork choices lead to the same node$/,
      )
      expect(r.out.some((line) => line.startsWith('content: package '))).toBe(false)
      expectNoOutputs(r.root)
    },
  )
})

// ---- Proof B (local only) ----

const MIGRATION_INPUT = join(storyboardDir, 'migration-input')
const PHASE1_DIR = join(MIGRATION_INPUT, 'packages')
const WAIVERS_DIR = join(MIGRATION_INPUT, 'waivers')
const SUMS_FILE = join(MIGRATION_INPUT, 'ni3-upload', 'SHA256SUMS.txt')

/**
 * A private waiver file, strict-parsed, or null. JSON.parse and zod messages are never surfaced:
 * a JSON error quotes the text near the fault, which could be a private field.
 */
function readWaiverFile(storyId: string): { bytes: Buffer; file: WaiverFile | null } {
  const bytes = readFileSync(join(WAIVERS_DIR, `${storyId}.json`))
  try {
    const parsed = WaiverFile.safeParse(JSON.parse(bytes.toString('utf8')))
    return { bytes, file: parsed.success ? parsed.data : null }
  } catch {
    return { bytes, file: null }
  }
}

describe.skipIf(!existsSync(PHASE1_DIR))(
  'Proof B, local only (skipped where storyboard/migration-input/packages is absent: migration-input is git-ignored, so CI never has it)',
  () => {
    const ids = () => phase1.map((p) => p.storyId)

    it('holds exactly the 11 phase-1 packages and the 11 waiver files', () => {
      expect(readdirSync(PHASE1_DIR).sort()).toEqual(ids().map((id) => `${id}.phase1.json`))
      expect(readdirSync(WAIVERS_DIR).sort()).toEqual(ids().map((id) => `${id}.json`))
    })

    it("the real phase-1 bytes equal the re-conversion and each waiver file's measuredOnPackageSha256, 11 of 11", () => {
      const differ: string[] = []
      const measuredDiffers: string[] = []
      for (const p of phase1) {
        const real = new Uint8Array(readFileSync(join(PHASE1_DIR, `${p.storyId}.phase1.json`)))
        if (sha256Of(real) !== p.sha256) differ.push(p.storyId)
        // Only the comparison's verdict is kept: never the waiver file's own value.
        const { file } = readWaiverFile(p.storyId)
        if (file?.measuredOnPackageSha256 !== sha256Of(real)) measuredDiffers.push(p.storyId)
      }
      expect(differ).toEqual([])
      expect(measuredDiffers).toEqual([])
    })

    it('deriveWaiverKeys over the real waiver files equals the committed keys file', () => {
      const derivedDiffers: string[] = []
      let keys = 0
      for (const id of ids()) {
        const { bytes, file } = readWaiverFile(id)
        if (!file) {
          derivedDiffers.push(id)
          continue
        }
        const derived = deriveWaiverKeys(file, sha256Of(bytes))
        keys += derived.keys.length
        // Derived blocks hold public fields only; compared as JCS, so key order cannot differ.
        if (toJcs(derived) !== toJcs(keysByStory.get(id))) derivedDiffers.push(id)
      }
      expect(derivedDiffers).toEqual([])
      expect(keys).toBe(41)
      // The whole file, as pnpm migrate:waiver-keys writes it, byte for byte (compared by hash).
      const built = buildLegacyWaiverKeys(WAIVERS_DIR, ids())
      expect(sha256Of(built.bytes)).toBe(sha256Of(readFileSync(KEYS_FILE)))
      expect([built.stories, built.keys, built.storiesWithoutKeys]).toEqual([11, 41, 2])
    })

    it("each waiver file's sha256 is its masters name in ni3-upload/SHA256SUMS.txt, 11 of 11", () => {
      const rows = readFileSync(SUMS_FILE, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/))
      const unmatched: string[] = []
      for (const id of ids()) {
        const bytes = readFileSync(join(WAIVERS_DIR, `${id}.json`))
        const sha = sha256Of(bytes)
        const row = rows.find((r) => r[3] === `waivers/${id}.json`)
        const named =
          row?.[0] === sha &&
          row[1] === `waivers/${id}/${sha}.json` &&
          row[2] === String(bytes.length)
        if (!named) unmatched.push(id)
      }
      expect(unmatched).toEqual([])
      // Counts only (design §10.3): never a waiver field.
      console.info(
        `Proof B: ${ids().length} phase-1 packages equal the re-conversion and their waiver files' measuredOnPackageSha256; ${ids().length} waiver files derive the committed 41 keys; ${ids().length - unmatched.length} of ${ids().length} waiver sha256 match SHA256SUMS.txt`,
      )
    })
  },
)
