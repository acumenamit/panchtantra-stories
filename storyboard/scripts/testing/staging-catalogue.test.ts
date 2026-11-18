// The staging catalogue's derived picture story and its id guard (design p1-step10-design.md §2.5,
// §4.5, §9.1 G4, §9.2 10e rows, O2, C11, C17, F2; Step 10e).
// - pictureStoryOf strict-parses, passes the package gate as the loader runs it (checkPackage: the
//   publish-mode validator, 0 errors) and the media path plan (12 HEADs); its hi flat_stones
//   passage is the fixture's own passage repeated to 3,600+ characters, every en text is the
//   fixture's, and its pictures have provenance { origin: 'unknown' }.
// - publishFixturesAsStaging with pictureStory publishes it and its 12 media objects, and the
//   in-process loader passes the media HEAD gate on the real loopback stub (platform win32).
// - playerNotFoundPaths(leg) adds the picture story's read URL on every leg but staging.
// - The scan of e2e/: the id's literal is in no file; only player-images.spec.ts and routes.ts name
//   PICTURE_STORY_ID or its module, and routes.ts names it exactly twice (its import and the one
//   template in playerNotFoundPaths). Its bypass forms are negative tests below. Every file under
//   e2e/ must be a script (.ts .mts .cts .js .mjs .cjs, in lower case: an upper- or mixed-case
//   extension is not one, review R3-ADV-3), the one kind the scan reads with its escapes resolved
//   (string, template and regex literals, identifiers): a data or page file could hold the id
//   escaped (a JSON \u, an HTML &#45;) where no reader of raw text sees it (review
//   R-FS-1). JSX is not read either: TypeScript keeps a character reference (&#45;) in JSX text and
//   in a JSX attribute string as written, and the JSX transform decodes it, so a .tsx or .jsx file
//   is not a script here, and a script that holds JSX (TypeScript and Playwright's transform read
//   JSX in .js, .mjs and .cjs files too) is rejected (review R2-guards-1). Documented limits: a
//   name assembled at run time ('river-stones' + '-pictures'), a regex that spells the id through
//   its own syntax (a class, a group, a quantifier), and data a spec loads from outside e2e/.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER_NOT_FOUND_PATHS, playerNotFoundPaths } from '../../e2e/routes'
import { BuildInfo } from '../../src/core/content/build-info'
import { judgeHead, planMediaHeads } from '../../src/core/content/media'
import { checkPackage } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { playerDataOf } from '../../src/reader/player/player-data'
import { loadContent } from '../load-content'
import { stagingEnvs } from '../preview-staging'
import { PICTURE_STORY_ID } from './picture-story-id'
import {
  FIXTURES_DIR,
  LONG_PASSAGE_MIN,
  longPassageOf,
  PICTURE_WEBP,
  pictureStoryOf,
  publishFixturesAsStaging,
  stagingPackages,
} from './staging-catalogue'
import { startStubStorage, type StubStorage } from './stub-storage'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E_DIR = join(REPO, 'e2e')
const NOW = new Date('2026-11-18T10:00:00.000Z')
const MEDIA = 'https://media.example/storage/v1/object/public/content/'
const ID = 'river-stones-pictures'
const FIXTURE_IDS = ['lantern-walk', 'river-stones', 'two-paths']
const STORY_IDS = ['lantern-walk', 'river-stones', ID, 'two-paths']
const MODE_LINE =
  'content: mode=staging seq=1 snapshot=catalogue/snapshots/1.json stories=4 excluded=0 featured=none'

/** The nodes with a picture and their shape, written out here (not read from the module). */
const WIDE = { width: 1408, height: 768, widths: [768, 1408] }
const SQUARE = { width: 1024, height: 1024, widths: [768, 1024] }
const SHAPES: Readonly<Record<string, typeof WIDE>> = {
  start: WIDE,
  flat_stones: WIDE,
  far_bank: SQUARE,
  round_stones: WIDE,
  ending_dry: WIDE,
  ending_wet: WIDE,
}

/** The fixture as stored: its JSON, a valid package (fixture() strict-parses it). */
const fixtureJson = (): StoryPackageV1 =>
  JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'packages', 'river-stones.json'), 'utf8'),
  ) as StoryPackageV1
const fixture = (): StoryPackageV1 => StoryPackageV1.parse(fixtureJson())
/** A package's hi flat_stones passage, or '' when it has none. */
const hiFlatStones = (pkg: StoryPackageV1): string => pkg.text.hi?.nodes.flat_stones?.text ?? ''
const assetId = (nodeId: string): string =>
  createHash('sha256').update(`${ID}:${nodeId}`).digest('hex')
const variantPath = (nodeId: string, width: number): string =>
  `media/${ID}/${assetId(nodeId)}-w${width}.webp`
const MEDIA_PATHS = Object.entries(SHAPES).flatMap(([nodeId, shape]) =>
  shape.widths.map((width) => variantPath(nodeId, width)),
)

/** Check id → count, per severity. */
function tally(
  findings: readonly { checkId: string; severity: string }[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = { error: {}, warn: {}, info: {} }
  for (const { checkId, severity } of findings) {
    const counts = (out[severity] ??= {})
    counts[checkId] = (counts[checkId] ?? 0) + 1
  }
  return out
}

/** The package gate as the loader runs it (load-content.ts:398): Storage, so canonical JCS. */
async function gate(pkg: StoryPackageV1) {
  const bytes = jcsBytes(pkg)
  const packageSha256 = await sha256Hex(bytes)
  const entry = {
    storyId: pkg.storyId,
    collectionId: pkg.collectionId,
    version: pkg.version,
    packagePath: `packages/${pkg.storyId}/${packageSha256}.json`,
    packageSha256,
  }
  return checkPackage(bytes, entry, PANCHATANTRA_RULESET, { requireJcs: true })
}

describe('PICTURE_STORY_ID, a leaf module (design §2.5, F2)', () => {
  it('is river-stones-pictures, the one statement of a module that imports nothing', () => {
    expect(PICTURE_STORY_ID).toBe(ID)
    const path = join(REPO, 'scripts', 'testing', 'picture-story-id.ts')
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    expect(file.statements.map((statement) => ts.isVariableStatement(statement))).toEqual([true])
    const [statement] = file.statements
    if (!statement || !ts.isVariableStatement(statement)) throw new Error('not a const')
    expect(statement.getText()).toBe(`export const PICTURE_STORY_ID = '${ID}'`)
  })
})

describe('pictureStoryOf (design §4.5, O2, C17)', () => {
  const source = fixture()
  const pkg = pictureStoryOf(source)

  it('strict-parses; only the id, the pictures and the hi flat_stones passage differ from the fixture', () => {
    expect(StoryPackageV1.parse(pkg)).toEqual(pkg)
    const expected = fixtureJson()
    expected.storyId = ID
    expected.nodes = expected.nodes.map((node) => ({
      ...node,
      image: Object.hasOwn(SHAPES, node.id) ? assetId(node.id) : null,
    }))
    expected.assets = pkg.assets
    const passage = expected.text.hi?.nodes.flat_stones
    if (passage === undefined) throw new Error('the fixture has no hi flat_stones passage')
    passage.text = hiFlatStones(pkg)
    expect(pkg).toEqual(expected)
    expect(source, 'the source package is not changed').toEqual(fixture())
  })

  it('keeps every English text as stored (a repeated en passage is an E004 error, O2)', () => {
    expect(pkg.text.en).toEqual(fixtureJson().text.en)
  })

  it("makes the hi flat_stones passage long with the fixture's own passage: 3,600+ characters", () => {
    const passage = hiFlatStones(fixtureJson())
    const long = hiFlatStones(pkg)
    expect(LONG_PASSAGE_MIN).toBe(3600)
    expect(long.length).toBeGreaterThanOrEqual(3600)
    expect(long.length).toBe(3648) // design §4.5: 3,648 measured
    const parts = long.split('\n\n')
    expect(new Set(parts)).toEqual(new Set([passage]))
    expect(parts.join('\n\n')).toBe(long)
    // The fewest copies that reach the minimum: one copy fewer is too short.
    expect((parts.length - 1) * (passage.length + 2) - 2).toBeLessThan(3600)
  })

  it('pictures on 6 nodes (far_bank square, C17), none on big_rock and ending_back; provenance unknown', () => {
    expect(Object.fromEntries(pkg.nodes.map((node) => [node.id, node.image]))).toEqual({
      start: assetId('start'),
      flat_stones: assetId('flat_stones'),
      big_rock: null,
      far_bank: assetId('far_bank'),
      round_stones: assetId('round_stones'),
      ending_dry: assetId('ending_dry'),
      ending_wet: assetId('ending_wet'),
      ending_back: null,
    })
    expect(pkg.assets).toEqual(
      Object.entries(SHAPES).map(([nodeId, shape]) => ({
        kind: 'image',
        id: assetId(nodeId),
        width: shape.width,
        height: shape.height,
        variants: shape.widths.map((width) => ({
          path: variantPath(nodeId, width),
          mime: 'image/webp',
          bytes: 34,
          width,
        })),
        provenance: { origin: 'unknown' },
      })),
    )
    expect(pkg.aiUse).toEqual(fixtureJson().aiUse)
  })

  it('serves one 34-byte 1×1 lossless WebP for every variant', () => {
    const text = (from: number, to: number) =>
      new TextDecoder().decode(PICTURE_WEBP.slice(from, to))
    expect(PICTURE_WEBP.length).toBe(34)
    expect([text(0, 4), text(8, 12), text(12, 16)]).toEqual(['RIFF', 'WEBP', 'VP8L'])
    expect(new DataView(PICTURE_WEBP.buffer).getUint32(4, true)).toBe(34 - 8)
  })

  it('passes the package gate as the loader runs it: publish mode, 0 errors (packages.ts:126)', async () => {
    const packages = await stagingPackages(FIXTURES_DIR, { pictureStory: true })
    const picture = packages.find((p) => p.entry.storyId === ID)
    if (!picture) throw new Error('no picture story')
    const checked = await checkPackage(picture.bytes, picture.entry, PANCHATANTRA_RULESET, {
      requireJcs: true,
    })
    if (!checked.ok) throw new Error(checked.reason)
    expect(checked.value.pkg).toEqual(pkg)
    expect(checked.value.counts).toEqual({ errors: 0, waived: 0, warnings: 18, info: 9 })
    const findings = checked.value.report.findings
    expect(tally(findings)).toEqual({ error: {}, warn: { A005: 16, A006: 2 }, info: { E004: 9 } })
    expect(findings.filter((f) => f.checkId === 'A006').map((f) => f.nodeId)).toEqual([
      'big_rock',
      'ending_back',
    ])
  })

  it('declares 12 variants that pass the media path plan and the HEAD rule on the stub answer', () => {
    const plan = planMediaHeads([{ pkg }], '')
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.value.heads.map((head) => [head.path, head.mime, head.bytes])).toEqual(
      MEDIA_PATHS.map((path) => [path, 'image/webp', 34]),
    )
    expect(plan.value.stories).toEqual([{ storyId: ID, variants: 12, bytes: 12 * 34 }])
    const answer = new Headers({ 'content-length': '34', 'content-type': 'image/webp' })
    for (const head of plan.value.heads) expect(judgeHead(head, 200, answer)).toEqual({ ok: true })
  })

  it('gives the player an image view on each picture node: ascending srcsets, its own size', () => {
    const data = playerDataOf(pkg, { locales: ['en', 'hi'], mediaUrl: (path) => MEDIA + path })
    expect(
      Object.fromEntries(
        data.nodes.map((node) => [
          node.id,
          node.image && [node.image.srcSet, node.image.width, node.image.height],
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        pkg.nodes.map((node) => {
          const shape = SHAPES[node.id]
          if (!shape) return [node.id, null]
          const srcSet = shape.widths
            .map((width) => `${MEDIA}${variantPath(node.id, width)} ${width}w`)
            .join(', ')
          return [node.id, [srcSet, shape.width, shape.height]]
        }),
      ),
    )
  })

  it('the shapes O2 ruled out fail these checks: en repeated, ai_generated provenance, no width', async () => {
    const enRepeated = structuredClone(pkg)
    const en = enRepeated.text.en?.nodes.flat_stones
    if (!en) throw new Error('no en flat_stones')
    en.text = longPassageOf(en.text) // the en passage repeated as the hi one is (O2: 693 words)
    const enGate = await gate(enRepeated)
    expect(enGate.ok).toBe(false)
    expect(enGate.ok ? '' : enGate.reason).toMatch(/1 unwaived error\(s\); first: E004/)

    const aiMade = structuredClone(pkg)
    for (const asset of aiMade.assets) asset.provenance = { origin: 'ai_generated' }
    const aiGate = await gate(aiMade)
    expect(aiGate.ok ? '' : aiGate.reason).toMatch(/unwaived error\(s\); first: A009/)

    const noWidth = structuredClone(pkg)
    const variant = noWidth.assets[2]?.variants[1]
    if (!variant) throw new Error('no far_bank variant')
    delete variant.width
    expect((await gate(noWidth)).ok, 'the validator does not check widths').toBe(true)
    expect(() => playerDataOf(noWidth, { locales: ['en'], mediaUrl: (path) => path })).toThrow(
      `player: ${ID} - far_bank image.width missing`,
    )
  })
})

describe('publishFixturesAsStaging with pictureStory (design §2.5, §4.5, C3)', () => {
  let root: string
  let stubs: StubStorage[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'staging-catalogue-'))
    stubs = []
  })

  afterEach(async () => {
    for (const stub of stubs) await stub.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function stub(): Promise<StubStorage> {
    const started = await startStubStorage()
    stubs.push(started)
    return started
  }

  const load = (base: string, out: string[], errors: string[]) =>
    loadContent({
      env: stagingEnvs({}, base).loader,
      root,
      platform: 'win32',
      now: () => NOW,
      log: (line) => void out.push(line),
      logError: (line) => void errors.push(line),
    })

  it('publishes 4 packages, the 12 media objects, the snapshot and, last, the pointer', async () => {
    const puts: { path: string; bytes: Uint8Array; type: string }[] = []
    const put = (path: string, bytes: Uint8Array, type: string) =>
      void puts.push({ path, bytes, type })
    const catalogue = await publishFixturesAsStaging({ put }, FIXTURES_DIR, { pictureStory: true })
    expect(catalogue.packages.map((p) => p.entry.storyId)).toEqual(STORY_IDS)
    expect(catalogue.media.map((m) => [m.path, m.contentType])).toEqual(
      MEDIA_PATHS.map((path) => [path, 'image/webp']),
    )
    expect(puts.map((p) => [p.path, p.type])).toEqual([
      ...catalogue.packages.map((p) => [p.entry.packagePath, 'application/json']),
      ...MEDIA_PATHS.map((path) => [path, 'image/webp']),
      ['catalogue/snapshots/1.json', 'application/json'],
      ['catalogue/staging.json', 'application/json'],
    ])
    for (const media of puts.filter((p) => p.type === 'image/webp')) {
      expect(media.bytes).toEqual(PICTURE_WEBP)
    }
    const picture = catalogue.packages.find((p) => p.entry.storyId === ID)
    const text = new TextDecoder().decode(picture?.bytes)
    expect(StoryPackageV1.parse(JSON.parse(text))).toEqual(pictureStoryOf(fixture()))

    // Without the option: the 3 fixtures and no media, as before (staging-build.test.ts).
    const plain = await publishFixturesAsStaging({ put: () => undefined })
    expect(plain.packages.map((p) => p.entry.storyId)).toEqual(FIXTURE_IDS)
    expect(plain.media).toEqual([])
  })

  it('loads in-process on win32 through the media HEAD gate: exit 0, 12 HEADs, 4 stories', async () => {
    const s = await stub()
    const catalogue = await publishFixturesAsStaging(s, FIXTURES_DIR, { pictureStory: true })
    const out: string[] = []
    const errors: string[] = []
    const code = await load(s.baseUrl, out, errors)
    expect(errors).toEqual([])
    expect(code).toBe(0)
    expect(s.requests.filter((r) => r.method === 'GET').map((r) => r.path)).toEqual([
      'catalogue/staging.json',
      'catalogue/snapshots/1.json',
      ...catalogue.packages.map((p) => p.entry.packagePath),
    ])
    const heads = s.requests.filter((r) => r.method === 'HEAD').map((r) => r.path)
    expect([...heads].sort()).toEqual([...MEDIA_PATHS].sort())
    expect(s.requests.map((r) => r.method).sort()).toEqual([
      ...Array<string>(6).fill('GET'),
      ...Array<string>(12).fill('HEAD'),
    ])
    expect(out).toContain(`content: media story=${ID} variants=12 bytes=408 ok`)
    expect(out.filter((line) => line.startsWith('content: media heads='))).toEqual([
      expect.stringMatching(/^content: media heads=12 ok=12 failed=0 retried=0 ms=\d+$/),
    ])
    expect(out.at(-1)).toBe(MODE_LINE)
    const info = BuildInfo.parse(
      JSON.parse(readFileSync(join(root, '.content', 'build-info.json'), 'utf8')),
    )
    expect(info.stories.map((story) => story.storyId)).toEqual(STORY_IDS)
    expect(readdirSync(join(root, '.content', 'packages')).sort()).toEqual(
      STORY_IDS.map((id) => `${id}.json`).sort(),
    )
  })

  it('the HEADs gate the load: a variant the stub lacks fails it at the media gate', async () => {
    const s = await stub()
    const missing = MEDIA_PATHS[5] ?? ''
    await publishFixturesAsStaging(
      { put: (path, bytes, type) => (path === missing ? undefined : s.put(path, bytes, type)) },
      FIXTURES_DIR,
      { pictureStory: true },
    )
    const errors: string[] = []
    const code = await load(s.baseUrl, [], errors)
    expect(code).toBe(1)
    expect(errors[0]).toBe(`content: media failed story=${ID} path=${missing} reason=status 400`)
    expect(errors).toContainEqual(
      expect.stringMatching(
        /^content gate failed: media HEAD failed for 1 of 12 variants; first: /,
      ),
    )
  })
})

describe('playerNotFoundPaths (design §2.5, S4, F2; T-a21 and the gated player test)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds the picture story read URL on every leg but staging, where it is a real page', () => {
    vi.stubEnv('E2E_LAUNCH', undefined)
    expect(PLAYER_NOT_FOUND_PATHS).toHaveLength(6)
    for (const leg of ['gated', 'review'] as const) {
      expect(playerNotFoundPaths(leg), leg).toEqual([
        ...PLAYER_NOT_FOUND_PATHS,
        `/en/stories/${ID}/read`,
      ])
    }
    expect(playerNotFoundPaths('staging')).toEqual([...PLAYER_NOT_FOUND_PATHS])
  })

  it("answers only for the run's own leg once E2E_LAUNCH is set: never the picture page on staging (review R-FS-1)", () => {
    vi.stubEnv('E2E_LAUNCH', 'staging')
    expect(playerNotFoundPaths('staging')).toEqual([...PLAYER_NOT_FOUND_PATHS])
    // A spec that also runs on the staging leg (a @review one), with a literal leg.
    expect(() => playerNotFoundPaths('review')).toThrow(
      "playerNotFoundPaths('review') on the staging leg: pass the run's leg",
    )
    expect(() => playerNotFoundPaths('gated')).toThrow(
      "playerNotFoundPaths('gated') on the staging leg: pass the run's leg",
    )
    vi.stubEnv('E2E_LAUNCH', 'review')
    expect(playerNotFoundPaths('review')).toEqual([
      ...PLAYER_NOT_FOUND_PATHS,
      `/en/stories/${ID}/read`,
    ])
    expect(() => playerNotFoundPaths('staging')).toThrow("on the review leg: pass the run's leg")
    vi.stubEnv('E2E_LAUNCH', 'gated')
    expect(playerNotFoundPaths('gated')).toHaveLength(7)
    // An empty value counts as set, and names no leg.
    vi.stubEnv('E2E_LAUNCH', '')
    expect(() => playerNotFoundPaths('gated')).toThrow('E2E_LAUNCH must be')
  })
})

// ---------------------------------------------------------------------------------------------
// The scan of e2e/ (design §9.1 G4, §9.2, C11, F2)

interface ScanFile {
  /** Relative to e2e/, '/'-separated. */
  readonly path: string
  readonly text: string
}

const ID_NAME = 'PICTURE_STORY_ID'
const ID_MODULE = 'picture-story-id'
/** It builds the picture story, so it holds the id too: only player-images.spec.ts may load it. */
const CATALOGUE_MODULE = 'staging-catalogue'
const NAMING_FILES: ReadonlySet<string> = new Set(['player-images.spec.ts', 'routes.ts'])
/**
 * No .tsx or .jsx: their JSX keeps character references the scan does not read (R2-guards-1).
 * Lower case only: matched case-insensitively, ids.JS would parse as TypeScript (scriptKindOf),
 * its JSX unseen (R3-ADV-3).
 */
const SCRIPT_FILE = /\.(?:ts|mts|cts|js|mjs|cjs)$/

/** Every file under e2e/, any depth, any extension. */
function e2eFiles(dir = E2E_DIR): ScanFile[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = join(entry.parentPath, entry.name)
      return { path: relative(dir, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }
    })
}

/** %XX sequences decoded byte by byte (never throws on a stray %). */
const percentDecoded = (text: string): string =>
  text.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))

const holdsId = (text: string): boolean =>
  [text, percentDecoded(text)].some((form) => form.toLowerCase().includes(ID))

/** One token of a script: its source text and its value (escapes decoded). */
interface Token {
  readonly node: ts.Node
  readonly raw: string
  readonly value: string
}

/** JavaScript files parse as JS, which reads JSX (so the scan can reject it); the rest as TS. */
function scriptKindOf(path: string): ts.ScriptKind {
  return /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

/**
 * A regex literal's pattern with its escapes resolved (an escaped punctuation character, \xHH,
 * \uHHHH, \u{H}). Letter escapes (\d, \b), classes, groups and quantifiers stay as written.
 */
function regexText(literal: string): string {
  const pattern = literal.slice(1, literal.lastIndexOf('/'))
  return pattern.replace(
    /\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([^0-9a-z]))/gi,
    (whole: string, braced?: string, unicode?: string, hex?: string, char?: string) => {
      if (char !== undefined) return char
      const code = parseInt(braced ?? unicode ?? hex ?? '', 16)
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    },
  )
}

/**
 * The string parts (string and template literals), the regex literals (their patterns, escapes
 * resolved) and the identifiers of a script, and whether it holds JSX (which the scan rejects).
 */
function tokensOf(file: ScanFile): {
  strings: Token[]
  names: Token[]
  regexes: Token[]
  jsx: boolean
} {
  const tree = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file.path),
  )
  const strings: Token[] = []
  const names: Token[] = []
  const regexes: Token[] = []
  let jsx = false
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      jsx = true
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push({ node, raw: node.getText(tree), value: node.text })
    } else if (ts.isRegularExpressionLiteral(node)) {
      regexes.push({ node, raw: node.getText(tree), value: regexText(node.text) })
    } else if (ts.isIdentifier(node)) {
      names.push({ node, raw: node.getText(tree), value: ts.idText(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { strings, names, regexes, jsx }
}

const countOf = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0
const NAME_PATTERN = new RegExp(`\\b${ID_NAME}\\b`, 'g')

/** Why routes.ts's two names are not exactly its import and the one template in the function. */
function routesProblems(strings: readonly Token[], names: readonly Token[]): string[] {
  const problems: string[] = []
  const modules = strings.filter((token) => token.value.includes(ID_MODULE))
  const declaration = modules[0]?.node.parent
  const bindings =
    modules.length === 1 && declaration && ts.isImportDeclaration(declaration)
      ? declaration.importClause
      : undefined
  const named = bindings?.namedBindings
  if (
    !bindings ||
    bindings.isTypeOnly ||
    bindings.name !== undefined ||
    !named ||
    !ts.isNamedImports(named) ||
    named.elements.length !== 1 ||
    named.elements[0]?.name.text !== ID_NAME
  ) {
    problems.push(`its one reference to the ${ID_MODULE} module is not \`import { ${ID_NAME} }\``)
  }
  const uses = names.filter(
    (token) => token.value === ID_NAME && !ts.isImportSpecifier(token.node.parent),
  )
  const inTemplate = (node: ts.Node): boolean => {
    const span = node.parent
    let scope: ts.Node | undefined = node
    while (scope && !ts.isFunctionDeclaration(scope)) scope = scope.parent
    return (
      ts.isTemplateSpan(span) &&
      span.expression === node &&
      scope !== undefined &&
      ts.isFunctionDeclaration(scope) &&
      scope.name?.text === 'playerNotFoundPaths'
    )
  }
  if (uses.length !== 1 || !uses.every((token) => inTemplate(token.node))) {
    problems.push(`its use is not the one template in playerNotFoundPaths`)
  }
  return problems
}

/** What the scan reports for a set of e2e files; empty when the rules hold. */
function pictureIdFindings(files: readonly ScanFile[]): string[] {
  const findings: string[] = []
  for (const file of files) {
    const script = SCRIPT_FILE.test(file.path)
    // Only a script's escapes are resolved, so only scripts may sit under e2e/ (R-FS-1).
    if (!script) findings.push(`${file.path}: is not a script, so the scan cannot read its escapes`)
    const { strings, names, regexes, jsx } = script
      ? tokensOf(file)
      : { strings: [], names: [], regexes: [], jsx: false }
    if (jsx) {
      findings.push(`${file.path}: holds JSX, whose character references the scan cannot read`)
    }
    if ([file.text, ...[...strings, ...regexes].map((token) => token.value)].some(holdsId)) {
      findings.push(`${file.path}: holds the picture story id as a literal`)
    }
    // Escaped forms count too: a token whose value holds the name (or module) but its text not.
    const escaped = (tokens: readonly Token[], needle: string) =>
      tokens.filter((token) => token.value.includes(needle) && !token.raw.includes(needle)).length
    const nameCount =
      countOf(file.text, NAME_PATTERN) + escaped([...strings, ...names, ...regexes], ID_NAME)
    const moduleCount =
      countOf(file.text, new RegExp(ID_MODULE, 'g')) + escaped([...strings, ...regexes], ID_MODULE)
    // Loading it takes a string (a specifier); a comment that names the module loads nothing.
    const catalogueCount = strings.filter((token) => token.value.includes(CATALOGUE_MODULE)).length
    if (!NAMING_FILES.has(file.path)) {
      if (nameCount > 0) findings.push(`${file.path}: names ${ID_NAME}`)
      if (moduleCount > 0) findings.push(`${file.path}: refers to the ${ID_MODULE} module`)
    } else if (file.path === 'routes.ts') {
      if (nameCount !== 2) findings.push(`routes.ts: names ${ID_NAME} ${nameCount} times, not 2`)
      for (const problem of routesProblems(strings, names)) findings.push(`routes.ts: ${problem}`)
    }
    if (file.path !== 'player-images.spec.ts' && catalogueCount > 0) {
      findings.push(`${file.path}: refers to the ${CATALOGUE_MODULE} module`)
    }
  }
  return findings
}

describe('the picture story id in e2e/ (design §9.1 G4, §9.2, C11, F2)', () => {
  const ROUTES = [
    "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'",
    "export const PLAYER_NOT_FOUND_PATHS = ['/en/stories/nope/read'] as const",
    'export function playerNotFoundPaths(leg: string): string[] {',
    "  if (leg === 'staging') return [...PLAYER_NOT_FOUND_PATHS]",
    '  return [...PLAYER_NOT_FOUND_PATHS, `/en/stories/${PICTURE_STORY_ID}/read`]',
    '}',
  ].join('\n')
  const IMAGES_SPEC = [
    "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'",
    "import { pictureStoryOf } from '../scripts/testing/staging-catalogue'",
    'const url = `/en/stories/${PICTURE_STORY_ID}/read`',
    'const hi = `/hi/stories/${PICTURE_STORY_ID}/read`',
  ].join('\n')
  const scan = (...extra: ScanFile[]) =>
    pictureIdFindings([
      { path: 'routes.ts', text: ROUTES },
      { path: 'player-images.spec.ts', text: IMAGES_SPEC },
      ...extra,
    ])
  const withRoutes = (text: string) =>
    pictureIdFindings([
      { path: 'routes.ts', text },
      { path: 'player-images.spec.ts', text: IMAGES_SPEC },
    ])

  it('the real e2e/ folder holds to it (every file, any depth)', () => {
    const files = e2eFiles()
    expect(files.map((file) => file.path)).toContain('routes.ts')
    expect(pictureIdFindings(files)).toEqual([])
  })

  it('reads every file under e2e/, at any depth and with any extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-scan-'))
    try {
      mkdirSync(join(dir, 'helpers', 'deep'), { recursive: true })
      writeFileSync(join(dir, 'a.spec.ts'), 'a')
      writeFileSync(join(dir, 'helpers', 'ids.mts'), 'b')
      writeFileSync(join(dir, 'helpers', 'deep', 'paths.json'), 'c')
      expect(e2eFiles(dir).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
        { path: 'a.spec.ts', text: 'a' },
        { path: 'helpers/deep/paths.json', text: 'c' },
        { path: 'helpers/ids.mts', text: 'b' },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts the allowed shape and near-misses', () => {
    expect(scan()).toEqual([])
    expect(
      scan({
        path: 'player.spec.ts',
        text: "page.goto('/en/stories/river-stones/read') // the picture story is elsewhere\nconst PICTURE_STORY_IDS = 1",
      }),
    ).toEqual([])
  })

  it.each([
    [
      'a plain literal in a spec',
      'player.spec.ts',
      "page.goto('/en/stories/river-stones-pictures/read')",
    ],
    ['a comment', 'player.spec.ts', '// opens river-stones-pictures'],
    ['upper case', 'player.spec.ts', "page.goto('/en/stories/RIVER-STONES-PICTURES/read')"],
    ['a \\u escape', 'player.spec.ts', "const id = 'river\\u002dstones-pictures'"],
    ['a \\u{} escape', 'player.spec.ts', "const id = 'river\\u{2d}stones-pictures'"],
    ['a \\x escape in a template', 'player.spec.ts', 'const id = `river\\x2Dstones-pictures`'],
    [
      'percent-encoded (upper)',
      'player.spec.ts',
      "page.goto('/en/stories/river%2Dstones-pictures/read')",
    ],
    [
      'percent-encoded (lower, every letter)',
      'player.spec.ts',
      "page.goto('/en/stories/%72%69%76%65%72%2d%73%74%6f%6e%65%73%2d%70%69%63%74%75%72%65%73/read')",
    ],
    ['a template head', 'player.spec.ts', 'const u = `/en/stories/river-stones-pictures/${page}`'],
    ['a regex literal', 'player.spec.ts', 'const re = /river-stones-pictures/'],
    [
      'a regex literal, hyphens escaped',
      'player.spec.ts',
      'const re = /river\\-stones\\-pictures/',
    ],
    [
      'a regex literal, \\x and \\u escapes, any case',
      'player.spec.ts',
      'const re = /RIVER\\x2dSTONES\\u002dpictures/i',
    ],
    [
      'a regex literal, a \\u{} escape',
      'player.spec.ts',
      'const re = /river\\u{2d}stones-pictures/u',
    ],
    ['a subfolder', 'helpers/ids.ts', "export const id = 'river-stones-pictures'"],
    ['a .mts file', 'ids.mts', "export const id = 'river-stones-pictures'"],
    ['a .cjs file', 'ids.cjs', "module.exports = 'river-stones-pictures'"],
    ['a .js file', 'ids.js', "export const id = 'river-stones-pictures'"],
    [
      'a .tsx file',
      'ids.tsx',
      'export const A = () => <a href="/en/stories/river-stones-pictures/read" />',
    ],
    ['a JSON file', 'paths.json', '["/en/stories/river-stones-pictures/read"]'],
    ['the allowed spec itself', 'player-images.spec.ts', "const id = 'river-stones-pictures'"],
  ])('rejects the literal: %s', (_label, path, text) => {
    const findings =
      path === 'player-images.spec.ts'
        ? pictureIdFindings([
            { path: 'routes.ts', text: ROUTES },
            { path, text },
          ])
        : scan({ path, text })
    expect(findings).toContain(`${path}: holds the picture story id as a literal`)
  })

  it('rejects the literal in routes.ts', () => {
    expect(withRoutes(`${ROUTES}\nconst x = '/en/stories/river-stones-pictures/read'`)).toContain(
      'routes.ts: holds the picture story id as a literal',
    )
  })

  it.each([
    ['a named import', "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'"],
    [
      'an alias import',
      "import { PICTURE_STORY_ID as P } from '../scripts/testing/picture-story-id'",
    ],
    ['an import through routes.ts', "import { PICTURE_STORY_ID } from './routes'"],
    ['an escaped identifier', "import { PICTURE\\u005FSTORY_ID as P } from './routes'"],
    ['a computed member', "import * as r from './routes'\nconst id = r['PICTURE_STORY_ID']"],
    [
      'an escaped computed member',
      "import * as r from './routes'\nconst id = r['PICTURE\\x5fSTORY_ID']",
    ],
    ['a comment', '// see PICTURE_STORY_ID'],
  ])('rejects naming it outside the two files: %s', (_label, text) => {
    expect(scan({ path: 'player.spec.ts', text })).toContain(`player.spec.ts: names ${ID_NAME}`)
  })

  it.each([
    ['a namespace import', "import * as ids from '../scripts/testing/picture-story-id'"],
    ['a dynamic import', "const ids = await import('../scripts/testing/picture-story-id')"],
    ['a require', "const ids = require('../scripts/testing/picture-story-id')"],
    ['an escaped specifier', "import * as ids from '../scripts/testing/picture\\u002dstory-id'"],
    ['a re-export', "export * from '../scripts/testing/picture-story-id'"],
  ])('rejects the module outside the two files: %s', (_label, text) => {
    expect(scan({ path: 'helpers.ts', text })).toContain(
      `helpers.ts: refers to the ${ID_MODULE} module`,
    )
  })

  it.each([
    [
      'a named import',
      'player.spec.ts',
      "import { pictureStoryOf } from '../scripts/testing/staging-catalogue'",
    ],
    [
      'a dynamic import',
      'player.spec.ts',
      "const c = await import('../scripts/testing/staging-catalogue')",
    ],
    [
      'an escaped specifier',
      'player.spec.ts',
      "import * as c from '../scripts/testing/staging\\u002dcatalogue'",
    ],
    [
      'a require',
      'player.spec.ts',
      "const { pictureVariantPath } = require('../scripts/testing/staging-catalogue.ts')",
    ],
    [
      'in routes.ts',
      'routes.ts',
      `${ROUTES}\nimport { pictureVariantPath } from '../scripts/testing/staging-catalogue'`,
    ],
  ])(
    'rejects the staging-catalogue module (it builds the picture story) outside the images spec: %s',
    (_label, path, text) => {
      const findings = path === 'routes.ts' ? withRoutes(text) : scan({ path, text })
      expect(findings).toContain(`${path}: refers to the ${CATALOGUE_MODULE} module`)
    },
  )

  it.each([
    [
      'a JSON escape in a data file',
      'paths.json',
      '["/en/stories/river\\u002dstones-pictures/read"]',
    ],
    [
      'an HTML entity in a page',
      'page.html',
      '<a href="/en/stories/river&#45;stones-pictures/read">',
    ],
    ['a CSS escape in a style sheet', 'look.css', 'a[href*="river\\2d stones-pictures"] {}'],
    ['any other file, with the id or not', 'notes.txt', 'hello'],
    // R2-guards-1: TypeScript keeps a character reference in JSX as written; JSX decodes it.
    [
      'a .tsx file, a character reference in a JSX attribute',
      'ids.tsx',
      'export const A = () => <a href="/en/stories/river&#45;stones-pictures/read" />',
    ],
    [
      'a .tsx file, character references in JSX text',
      'ids.tsx',
      'export const B = () => <p>/en/stories/river&#x2d;stones&#45;pictures/read</p>',
    ],
    [
      'a .jsx file',
      'ids.jsx',
      'export const A = () => <a href="/en/stories/river&#45;stones-pictures/read" />',
    ],
    // R3-ADV-3 (catalogue class 3, letter case): read as a script, an upper- or mixed-case file
    // would parse as TypeScript and its JSX would hide the id.
    [
      'an upper-case .JS file with JSX',
      'ids.JS',
      'export const A = () => <a href="/en/stories/river&#45;stones-pictures/read" />',
    ],
    [
      'a mixed-case .Mjs file with JSX text',
      'ids.Mjs',
      'export const B = () => <p>/en/stories/river&#x2d;stones&#45;pictures/read</p>',
    ],
    [
      'an upper-case .TSX file',
      'IDS.TSX',
      'export const A = () => <a href="/en/stories/river&#45;stones-pictures/read" />',
    ],
  ])('rejects a file that is not a script: %s', (_label, path, text) => {
    expect(scan({ path, text })).toContain(
      `${path}: is not a script, so the scan cannot read its escapes`,
    )
  })

  // R2-guards-1: TypeScript and Playwright's transform read JSX in .js, .mjs and .cjs files too.
  it.each([
    [
      'a .js file, a character reference in a JSX attribute',
      'ids.js',
      'export const A = () => <a href="/en/stories/river&#45;stones-pictures/read" />',
    ],
    [
      'a .mjs file, character references in JSX text',
      'ids.mjs',
      'export const B = () => <p>/en/stories/river&#x2d;stones&#45;pictures/read</p>',
    ],
    ['a .cjs file, a JSX fragment', 'ids.cjs', 'module.exports = <>river&#45;stones-pictures</>'],
    ['a .js file, JSX without the id', 'ids.js', 'export const A = () => <a href="/en/" />'],
  ])('rejects a script that holds JSX: %s', (_label, path, text) => {
    expect(scan({ path, text })).toContain(
      `${path}: holds JSX, whose character references the scan cannot read`,
    )
  })

  it('accepts scripts whose < and > are not JSX: comparisons and type arguments', () => {
    expect(
      scan(
        { path: 'compare.js', text: 'export const within = (a, b, c) => a < b && b > c' },
        {
          path: 'compare.mjs',
          text: 'export const less = (a, b) => a < b\nexport const x = 1 > 0',
        },
        {
          path: 'types.ts',
          text: 'export const m = new Map<string, number>()\nconst f = <T,>(x: T) => x',
        },
      ),
    ).toEqual([])
  })

  it.each([
    ['the name', '/PICTURE\\_STORY\\_ID/', `player.spec.ts: names ${ID_NAME}`],
    ['the module', '/picture\\-story\\-id/', `player.spec.ts: refers to the ${ID_MODULE} module`],
  ])('rejects a regex literal that holds %s escaped', (_label, regex, finding) => {
    expect(scan({ path: 'player.spec.ts', text: `const re = ${regex}` })).toContain(finding)
  })

  it('accepts regex literals with escapes that do not hold the id', () => {
    expect(
      scan({
        path: 'player.spec.ts',
        text: 'const re = /\\/stories\\/[^/]+\\/read$/\nconst near = /river\\-stones\\/read/',
      }),
    ).toEqual([])
  })

  it.each([
    ['upper-case routes', 'Routes.ts'],
    ['routes in a subfolder', 'sub/routes.ts'],
    ['the images spec in a subfolder', 'sub/player-images.spec.ts'],
    ['the images spec as .mts', 'player-images.spec.mts'],
  ])('allows only the two files by exact name: %s', (_label, path) => {
    expect(scan({ path, text: IMAGES_SPEC })).toContain(`${path}: names ${ID_NAME}`)
  })

  it.each([
    [
      'a third name: PLAYER_DOC_PATHS gains the page through the import (design §9.2 mutant)',
      `${ROUTES}\nexport const PLAYER_DOC_PATHS = [\`/en/stories/\${PICTURE_STORY_ID}/read\`]`,
      'routes.ts: names PICTURE_STORY_ID 3 times, not 2',
    ],
    [
      'a re-export of the name',
      `${ROUTES}\nexport { PICTURE_STORY_ID }`,
      'routes.ts: names PICTURE_STORY_ID 3 times, not 2',
    ],
    [
      'a re-export of the module',
      `${ROUTES}\nexport * from '../scripts/testing/picture-story-id'`,
      'routes.ts: its one reference to the picture-story-id module is not `import { PICTURE_STORY_ID }`',
    ],
    [
      'an alias import',
      ROUTES.replace('{ PICTURE_STORY_ID }', '{ PICTURE_STORY_ID as P }').replace(
        '${PICTURE_STORY_ID}',
        '${P}',
      ),
      'routes.ts: names PICTURE_STORY_ID 1 times, not 2',
    ],
    [
      'an alias import with a comment that keeps the count at 2',
      ROUTES.replace('{ PICTURE_STORY_ID }', '{ PICTURE_STORY_ID as P }')
        .replace('${PICTURE_STORY_ID}', '${P}')
        .concat('\n// P is PICTURE_STORY_ID'),
      'routes.ts: its one reference to the picture-story-id module is not `import { PICTURE_STORY_ID }`',
    ],
    [
      'the use outside playerNotFoundPaths',
      ROUTES.replace('function playerNotFoundPaths', 'function otherPaths'),
      'routes.ts: its use is not the one template in playerNotFoundPaths',
    ],
    [
      'the use not in a template',
      ROUTES.replace('`/en/stories/${PICTURE_STORY_ID}/read`', "'/en/stories/' + PICTURE_STORY_ID"),
      'routes.ts: its use is not the one template in playerNotFoundPaths',
    ],
    [
      'a namespace import in place of the named one',
      ROUTES.replace('{ PICTURE_STORY_ID }', '* as ids').replace(
        '${PICTURE_STORY_ID}',
        '${ids.PICTURE_STORY_ID}',
      ),
      'routes.ts: its one reference to the picture-story-id module is not `import { PICTURE_STORY_ID }`',
    ],
    [
      'an escaped name as a third',
      `${ROUTES}\nexport const again = PICTURE\\u005FSTORY_ID`,
      'routes.ts: names PICTURE_STORY_ID 3 times, not 2',
    ],
  ])('rejects routes.ts other than its import and one template: %s', (_label, text, finding) => {
    expect(withRoutes(text)).toContain(finding)
  })
})
