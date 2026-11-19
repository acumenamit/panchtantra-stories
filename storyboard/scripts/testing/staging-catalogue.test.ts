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
// P1-5a Step 11 (design p1-step11-design.md §3.23 N23, §8.1, §9 A27, A28, A36, §13.3 T11-21,
// T11-23, T11-24, §13.5):
// - narratedStoryOf derives the staging-only narrated story from river-stones: the fixture as
//   stored plus 15 audio assets (every node in en and hi but big_rock in hi), each one variant of
//   the 42-frame silent MP3 (6,048 bytes, audio/mpeg), provenance { origin: 'unknown' }. With
//   narrationStory alone the catalogue holds 4 packages and the loader makes 15 media HEADs; with
//   pictureStory too, 5 packages and 27 HEADs, the picture rows still the 34-byte WebP. The
//   picture-only cases below keep 4 packages and 12 HEADs.
// - playerNotFoundPaths(leg) adds the narrated story's read URL after the picture story's on every
//   leg but staging (planned expectation updates: the lists, and 7 → 8 on the gated leg).
// - The scan of e2e/ runs once per id (T11-24): the narrated story's id, its name
//   NARRATION_STORY_ID and its module narration-story-id are held to player-audio.spec.ts and
//   routes.ts exactly as the picture story's are to player-images.spec.ts and routes.ts, and the
//   module that builds its clip paths (narration-story) to player-audio.spec.ts and
//   e2e/narration-media.ts. Review round 1 (S11-R1-FS-2): narration-media itself, which exports
//   the built clip URLs, is held to player-audio.spec.ts, so no other spec can take them from it;
//   the media answer (H2), which security-guard.spec.ts needs, lives in media-answer.ts, which
//   exports no clip URL. Review round 2 (S11-R2-FS-1): media-answer.ts may not load
//   narration-story either (it takes the probe clip's bytes from silent-mp3), so no re-export
//   through it can reach the guard spec. On Windows
//   WebKit a detached audio element's request escapes
//   Playwright's network layer (PR-3), so a narration tap in any other spec could reach the real
//   media origin unseen. Every negative sample of the picture scan is repeated for the new id.
//   staging-catalogue also derives the narrated story; the picture rule already holds that module
//   to player-images.spec.ts, where it cannot load (import.meta).
// - Review round 3 (S11-R3-FS-1; guard-bypass catalogue lint class 12, the fence through a helper
//   module): the scan above reads e2e/ only, so a module elsewhere (scripts/, src/, tools/) that
//   re-exports or wraps a builder would hand any spec its paths unseen. The reach walk follows what
//   each e2e entry (every loadable file under e2e/, and playwright.config.ts) loads, across the
//   repository: import and export from (type-only too), import-equals, require() and import() with
//   a literal specifier, and import types; relative, tsconfig-alias and index specifiers, a .js
//   specifier for a .ts file, every script extension, '\' separators and '.'/'..' segments, any
//   letter case (Windows loads them). narration-story may be reached only from player-audio.spec.ts
//   and narration-media.ts, narration-media only from player-audio.spec.ts, staging-catalogue only
//   from player-images.spec.ts (and staging-catalogue loads narration-story, so today no e2e entry
//   may reach it). Fail closed: a relative or alias specifier the walk cannot find, an absolute
//   path or URL, or a file outside the repository is a finding. Documented limits: a specifier
//   assembled at run time (a concatenation, a template with a substitution, a variable), a loader
//   other than those forms (createRequire, a Worker, eval or vm), a package under node_modules,
//   and a copy of a builder's code.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, sep } from 'node:path'
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
import { NARRATION_STORY_ID } from './narration-story-id'
import { PICTURE_STORY_ID } from './picture-story-id'
import { silentMp3 } from './silent-mp3'
import {
  FIXTURES_DIR,
  LONG_PASSAGE_MIN,
  longPassageOf,
  narratedStoryOf,
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
/** The narrated story (Step 11), written out here as the picture story's id is above. */
const NARRATED_ID = 'river-stones-narrated'
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

/** The narrated story's clips: every node in en and hi, but big_rock in hi (N12), written out. */
const NARRATED_NODES = [
  'start',
  'flat_stones',
  'big_rock',
  'far_bank',
  'round_stones',
  'ending_dry',
  'ending_wet',
  'ending_back',
]
const NARRATED_CLIPS = NARRATED_NODES.flatMap((nodeId) =>
  (['en', 'hi'] as const)
    .filter((locale) => !(nodeId === 'big_rock' && locale === 'hi'))
    .map((locale) => ({ nodeId, locale })),
)
const narratedSha = (text: string): string => createHash('sha256').update(text).digest('hex')
const narratedPath = (nodeId: string, locale: string): string =>
  `media/${NARRATED_ID}/${narratedSha(`${NARRATED_ID}:${nodeId}:${locale}:audio`)}-audio.mp3`
const NARRATED_PATHS = NARRATED_CLIPS.map(({ nodeId, locale }) => narratedPath(nodeId, locale))
/** The 42-frame silent MP3 every clip path serves (design §3.23): 6,048 bytes. */
const CLIP_BYTES = 6048

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

describe('narratedStoryOf (design p1-step11 §3.23 N23, §8.1, A27, T11-21)', () => {
  const source = fixture()
  const pkg = narratedStoryOf(source)

  it('strict-parses; only the id and the 15 audio assets differ from the fixture', () => {
    expect(NARRATION_STORY_ID, 'the leaf module names the same id').toBe(NARRATED_ID)
    expect(StoryPackageV1.parse(pkg)).toEqual(pkg)
    const expected = fixtureJson()
    expected.storyId = NARRATED_ID
    expected.assets = pkg.assets
    expect(pkg).toEqual(expected)
    expect(source, 'the source package is not changed').toEqual(fixture())
    expect(pkg.text, 'every text as stored').toEqual(fixtureJson().text)
    expect(pkg.aiUse, 'aiUse as stored').toEqual(fixtureJson().aiUse)
    expect(
      pkg.nodes.map((node) => node.image),
      'images as stored (none)',
    ).toEqual(Array<null>(8).fill(null))
  })

  it('15 audio assets, one silent MP3 variant each, provenance unknown, no clip for big_rock in hi', () => {
    expect(NARRATED_CLIPS).toHaveLength(15)
    expect(pkg.assets).toEqual(
      NARRATED_CLIPS.map(({ nodeId, locale }) => ({
        kind: 'audio',
        id: narratedSha(`${NARRATED_ID}:${nodeId}:${locale}:audio`),
        nodeId,
        locale,
        durationMs: 1008,
        variants: [{ path: narratedPath(nodeId, locale), mime: 'audio/mpeg', bytes: CLIP_BYTES }],
        provenance: { origin: 'unknown' },
        narratedTextSha256: narratedSha(`${NARRATED_ID}:${nodeId}:${locale}`),
      })),
    )
  })

  it('(g1) narrationStory alone: 4 packages; the derived one passes the gate, A005 only for big_rock in hi', async () => {
    const packages = await stagingPackages(FIXTURES_DIR, { narrationStory: true })
    expect(packages.map((p) => p.entry.storyId)).toEqual([
      'lantern-walk',
      'river-stones',
      NARRATED_ID,
      'two-paths',
    ])
    const narrated = packages.find((p) => p.entry.storyId === NARRATED_ID)
    if (!narrated) throw new Error('no narrated story')
    const checked = await checkPackage(narrated.bytes, narrated.entry, PANCHATANTRA_RULESET, {
      requireJcs: true,
    })
    if (!checked.ok) throw new Error(checked.reason)
    expect(checked.value.pkg).toEqual(pkg)
    const findings = checked.value.report.findings
    expect(checked.value.counts.errors, 'validator errors').toBe(0)
    // Every node lacks a picture (A006, images as stored); one node and language lacks a clip.
    expect(tally(findings).error).toEqual({})
    expect(tally(findings).warn).toEqual({ A005: 1, A006: 8 })
    expect(
      findings.filter((f) => f.checkId === 'A005').map((f) => [f.nodeId, f.locale]),
      'the one part with no clip (N12)',
    ).toEqual([['big_rock', 'hi']])
    expect(
      findings.filter((f) => f.checkId === 'A009'),
      'no AI-made narration (A009)',
    ).toEqual([])
  })

  it('declares 15 variants that pass the media path plan and the HEAD rule on the stub answer', () => {
    const plan = planMediaHeads([{ pkg }], '')
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.value.heads.map((head) => [head.path, head.mime, head.bytes])).toEqual(
      NARRATED_PATHS.map((path) => [path, 'audio/mpeg', CLIP_BYTES]),
    )
    expect(plan.value.stories).toEqual([
      { storyId: NARRATED_ID, variants: 15, bytes: 15 * CLIP_BYTES },
    ])
    const answer = new Headers({ 'content-length': '6048', 'content-type': 'audio/mpeg' })
    for (const head of plan.value.heads) expect(judgeHead(head, 200, answer)).toEqual({ ok: true })
  })

  it('refuses another source story', () => {
    const other = { ...source, storyId: 'two-paths' }
    expect(() => narratedStoryOf(other)).toThrow(
      'staging: the narrated story derives from river-stones only',
    )
  })
})

describe('publishFixturesAsStaging with narrationStory (design p1-step11 §8.1, T11-21)', () => {
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

  it('publishes the 15 clips as audio/mpeg, each the 6,048-byte silent MP3', async () => {
    const puts: { path: string; bytes: Uint8Array; type: string }[] = []
    const catalogue = await publishFixturesAsStaging(
      { put: (path, bytes, type) => void puts.push({ path, bytes, type }) },
      FIXTURES_DIR,
      { narrationStory: true },
    )
    expect(catalogue.media.map((m) => [m.path, m.contentType])).toEqual(
      NARRATED_PATHS.map((path) => [path, 'audio/mpeg']),
    )
    const clips = puts.filter((p) => p.path.startsWith('media/'))
    expect(clips.map((p) => [p.path, p.type])).toEqual(
      NARRATED_PATHS.map((path) => [path, 'audio/mpeg']),
    )
    for (const clip of clips) expect(clip.bytes).toEqual(silentMp3(42))
  })

  it('(g2) loads in-process on win32 through the media HEAD gate: exit 0, 15 HEADs, 4 stories', async () => {
    const s = await stub()
    await publishFixturesAsStaging(s, FIXTURES_DIR, { narrationStory: true })
    const out: string[] = []
    const errors: string[] = []
    const code = await load(s.baseUrl, out, errors)
    expect(errors).toEqual([])
    expect(code).toBe(0)
    const heads = s.requests.filter((r) => r.method === 'HEAD').map((r) => r.path)
    expect([...heads].sort()).toEqual([...NARRATED_PATHS].sort())
    expect(out).toContain(`content: media story=${NARRATED_ID} variants=15 bytes=90720 ok`)
    expect(out.filter((line) => line.startsWith('content: media heads='))).toEqual([
      expect.stringMatching(/^content: media heads=15 ok=15 failed=0 retried=0 ms=\d+$/),
    ])
    expect(out.at(-1)).toBe(MODE_LINE)
    const info = BuildInfo.parse(
      JSON.parse(readFileSync(join(root, '.content', 'build-info.json'), 'utf8')),
    )
    expect(info.stories.map((story) => story.storyId)).toEqual([
      'lantern-walk',
      'river-stones',
      NARRATED_ID,
      'two-paths',
    ])
  })

  it('(g3) with pictureStory too: 5 packages, 27 HEADs, the picture rows still the 34-byte WebP', async () => {
    const s = await stub()
    const catalogue = await publishFixturesAsStaging(s, FIXTURES_DIR, {
      pictureStory: true,
      narrationStory: true,
    })
    expect(catalogue.packages.map((p) => p.entry.storyId)).toEqual([
      'lantern-walk',
      'river-stones',
      ID,
      NARRATED_ID,
      'two-paths',
    ])
    expect(catalogue.media.map((m) => [m.path, m.contentType, m.bytes.length])).toEqual([
      ...MEDIA_PATHS.map((path) => [path, 'image/webp', 34]),
      ...NARRATED_PATHS.map((path) => [path, 'audio/mpeg', CLIP_BYTES]),
    ])
    for (const picture of catalogue.media.slice(0, 12)) expect(picture.bytes).toEqual(PICTURE_WEBP)
    const out: string[] = []
    const errors: string[] = []
    const code = await load(s.baseUrl, out, errors)
    expect(errors).toEqual([])
    expect(code).toBe(0)
    const heads = s.requests.filter((r) => r.method === 'HEAD').map((r) => r.path)
    expect([...heads].sort()).toEqual([...MEDIA_PATHS, ...NARRATED_PATHS].sort())
    expect(out).toContain(`content: media story=${ID} variants=12 bytes=408 ok`)
    expect(out).toContain(`content: media story=${NARRATED_ID} variants=15 bytes=90720 ok`)
    expect(out.at(-1)).toBe(MODE_LINE.replace('stories=4', 'stories=5'))
  })

  it('the HEADs gate the load: a clip the stub lacks fails it at the media gate', async () => {
    const s = await stub()
    const missing = NARRATED_PATHS[3] ?? ''
    await publishFixturesAsStaging(
      { put: (path, bytes, type) => (path === missing ? undefined : s.put(path, bytes, type)) },
      FIXTURES_DIR,
      { narrationStory: true },
    )
    const errors: string[] = []
    const code = await load(s.baseUrl, [], errors)
    expect(code).toBe(1)
    expect(errors[0]).toBe(
      `content: media failed story=${NARRATED_ID} path=${missing} reason=status 400`,
    )
  })
})

describe('playerNotFoundPaths (design §2.5, S4, F2; T-a21 and the gated player test)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Step 11 (T11-23, planned update): the narrated story's read URL follows the picture story's.
  it('adds the picture and narrated story read URLs on every leg but staging, where they are real pages', () => {
    vi.stubEnv('E2E_LAUNCH', undefined)
    expect(PLAYER_NOT_FOUND_PATHS).toHaveLength(6)
    for (const leg of ['gated', 'review'] as const) {
      expect(playerNotFoundPaths(leg), `(g1) ${leg}`).toEqual([
        ...PLAYER_NOT_FOUND_PATHS,
        `/en/stories/${ID}/read`,
        `/en/stories/${NARRATED_ID}/read`,
      ])
    }
    expect(playerNotFoundPaths('staging'), '(g2) staging').toEqual([...PLAYER_NOT_FOUND_PATHS])
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
      `/en/stories/${NARRATED_ID}/read`,
    ])
    expect(() => playerNotFoundPaths('staging')).toThrow("on the review leg: pass the run's leg")
    vi.stubEnv('E2E_LAUNCH', 'gated')
    expect(playerNotFoundPaths('gated'), '(g3) gated').toHaveLength(8)
    // An empty value counts as set, and names no leg.
    vi.stubEnv('E2E_LAUNCH', '')
    expect(() => playerNotFoundPaths('gated')).toThrow('E2E_LAUNCH must be')
  })
})

// ---------------------------------------------------------------------------------------------
// The scan of e2e/ (design §9.1 G4, §9.2, C11, F2; Step 11 T11-24: the same rules for each id)

interface ScanFile {
  /** Relative to e2e/, '/'-separated. */
  readonly path: string
  readonly text: string
}

/** A module that builds a story's media paths or package, so holds its id: only `files` load it. */
interface BuilderModule {
  readonly name: string
  /** Whether a string's value (escapes resolved, any letter case) refers to the module. */
  readonly matches: (value: string) => boolean
  readonly files: ReadonlySet<string>
}

/** One staging-only story id the scan keeps out of e2e/ (C11; Step 11 T11-24). */
interface IdRule {
  /** The id's literal, in lower case. */
  readonly id: string
  /** What the literal finding calls it. */
  readonly label: string
  /** The exported name of the id (a leaf module's one const). */
  readonly name: string
  /** The leaf module's file name, without its extension. */
  readonly module: string
  /** Only these two may name it and load its module; routes.ts names it exactly twice. */
  readonly namingFiles: ReadonlySet<string>
  readonly builders: readonly BuilderModule[]
}

const PICTURE_RULE: IdRule = {
  id: ID,
  label: 'picture story',
  name: 'PICTURE_STORY_ID',
  module: 'picture-story-id',
  namingFiles: new Set(['player-images.spec.ts', 'routes.ts']),
  // It builds the picture story, so it holds the id too: only player-images.spec.ts may load it.
  builders: [
    {
      name: 'staging-catalogue',
      matches: (value) => value.toLowerCase().includes('staging-catalogue'),
      files: new Set(['player-images.spec.ts']),
    },
  ],
}

const NARRATION_RULE: IdRule = {
  id: NARRATED_ID,
  label: 'narrated story',
  name: 'NARRATION_STORY_ID',
  module: 'narration-story-id',
  namingFiles: new Set(['player-audio.spec.ts', 'routes.ts']),
  // It builds the clip paths from the id: the narration spec and its media helpers only. The id's
  // own module (narration-story-id) is not this module. The media helpers export the built clip
  // URLs, so they are held to the narration spec (review round 1, S11-R1-FS-2). The media answer,
  // which the guard spec loads, takes the clip's bytes from the leaf silent-mp3 module, so a
  // re-export through it cannot hand the guard spec the builder (review round 2, S11-R2-FS-1).
  builders: [
    {
      name: 'narration-story',
      matches: (value) => /narration-story(?!-id)/i.test(value),
      files: new Set(['player-audio.spec.ts', 'narration-media.ts']),
    },
    {
      name: 'narration-media',
      matches: (value) => /narration-media/i.test(value),
      files: new Set(['player-audio.spec.ts']),
    },
  ],
}

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

const holdsId = (text: string, id: string): boolean =>
  [text, percentDecoded(text)].some((form) => form.toLowerCase().includes(id))

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

/** Why routes.ts's two names are not exactly its import and the one template in the function. */
function routesProblems(
  rule: IdRule,
  strings: readonly Token[],
  names: readonly Token[],
): string[] {
  const problems: string[] = []
  const modules = strings.filter((token) => token.value.toLowerCase().includes(rule.module))
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
    named.elements[0]?.name.text !== rule.name
  ) {
    problems.push(
      `its one reference to the ${rule.module} module is not \`import { ${rule.name} }\``,
    )
  }
  const uses = names.filter(
    (token) => token.value === rule.name && !ts.isImportSpecifier(token.node.parent),
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

/** What the scan reports for one id over a set of e2e files; empty when the rules hold. */
function idFindings(files: readonly ScanFile[], rule: IdRule): string[] {
  const findings: string[] = []
  const namePattern = new RegExp(`\\b${rule.name}\\b`, 'g')
  const modulePattern = new RegExp(rule.module, 'gi')
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
    if (
      [file.text, ...[...strings, ...regexes].map((token) => token.value)].some((text) =>
        holdsId(text, rule.id),
      )
    ) {
      findings.push(`${file.path}: holds the ${rule.label} id as a literal`)
    }
    // Escaped forms count too: a token whose value holds the name (or module) but its text not.
    const escaped = (tokens: readonly Token[], needle: string, fold: boolean) =>
      tokens.filter((token) => {
        const value = fold ? token.value.toLowerCase() : token.value
        const raw = fold ? token.raw.toLowerCase() : token.raw
        return value.includes(needle) && !raw.includes(needle)
      }).length
    const nameCount =
      countOf(file.text, namePattern) +
      escaped([...strings, ...names, ...regexes], rule.name, false)
    const moduleCount =
      countOf(file.text, modulePattern) + escaped([...strings, ...regexes], rule.module, true)
    if (!rule.namingFiles.has(file.path)) {
      if (nameCount > 0) findings.push(`${file.path}: names ${rule.name}`)
      if (moduleCount > 0) findings.push(`${file.path}: refers to the ${rule.module} module`)
    } else if (file.path === 'routes.ts') {
      if (nameCount !== 2) findings.push(`routes.ts: names ${rule.name} ${nameCount} times, not 2`)
      for (const problem of routesProblems(rule, strings, names)) {
        findings.push(`routes.ts: ${problem}`)
      }
    }
    // Loading it takes a string (a specifier); a comment that names the module loads nothing.
    for (const builder of rule.builders) {
      const count = strings.filter((token) => builder.matches(token.value)).length
      if (count > 0 && !builder.files.has(file.path)) {
        findings.push(`${file.path}: refers to the ${builder.name} module`)
      }
    }
  }
  return findings
}

const pictureIdFindings = (files: readonly ScanFile[]): string[] => idFindings(files, PICTURE_RULE)
const narratedIdFindings = (files: readonly ScanFile[]): string[] =>
  idFindings(files, NARRATION_RULE)

// ---------------------------------------------------------------------------------------------
// The reach walk (review round 3, S11-R3-FS-1; lint class 12): what each e2e entry loads, followed
// across the repository, so a builder wrapped or re-exported outside e2e/ is still held.

/** A builder module (repository path, lower case) and the e2e entries that may reach it. */
interface ReachFence {
  readonly name: string
  readonly file: string
  readonly entries: ReadonlySet<string>
}

const REACH_FENCES: readonly ReachFence[] = [
  {
    name: 'narration-story',
    file: 'scripts/testing/narration-story.ts',
    entries: new Set(['e2e/player-audio.spec.ts', 'e2e/narration-media.ts']),
  },
  {
    name: 'narration-media',
    file: 'e2e/narration-media.ts',
    entries: new Set(['e2e/player-audio.spec.ts', 'e2e/narration-media.ts']),
  },
  // The picture rule's builder. It derives the narrated story too (it loads narration-story), so
  // the narration-story fence also holds it: today no e2e entry may reach it.
  {
    name: 'staging-catalogue',
    file: 'scripts/testing/staging-catalogue.ts',
    entries: new Set(['e2e/player-images.spec.ts']),
  },
]

/** The extensions a specifier may leave out, in TypeScript's order, and a .json. */
const LOADABLE = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const
/** A loaded file the walk reads for what it loads in turn (any letter case). */
const WALKED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i

/** Repository files by '/'-separated relative path, found in any letter case (Windows loads them). */
interface RepoFiles {
  /** The stored path of `path` in any letter case, or undefined (no such file). */
  readonly find: (path: string) => string | undefined
  readonly text: (path: string) => string
}

/** The real repository, listed on demand: each directory once, its names matched in any case. */
function repoFiles(root = REPO): RepoFiles {
  const listings = new Map<string, Map<string, { name: string; file: boolean }>>()
  const listing = (dir: string): Map<string, { name: string; file: boolean }> => {
    let entries = listings.get(dir)
    if (entries === undefined) {
      entries = new Map()
      try {
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
          entries.set(entry.name.toLowerCase(), { name: entry.name, file: entry.isFile() })
        }
      } catch {
        // Not a directory: nothing under it.
      }
      listings.set(dir, entries)
    }
    return entries
  }
  return {
    find: (path) => {
      let dir = ''
      const parts = path.split('/')
      for (const [index, part] of parts.entries()) {
        const entry = listing(dir).get(part.toLowerCase())
        if (entry === undefined) return undefined
        const next = dir === '' ? entry.name : `${dir}/${entry.name}`
        if (index === parts.length - 1) return entry.file ? next : undefined
        if (entry.file) return undefined
        dir = next
      }
      return undefined
    },
    text: (path) => readFileSync(join(root, path), 'utf8'),
  }
}

/** Files given as text (the samples), found in any letter case as on Windows. */
function textFiles(files: Readonly<Record<string, string>>): RepoFiles {
  const byLower = new Map(Object.keys(files).map((path) => [path.toLowerCase(), path]))
  return { find: (path) => byLower.get(path.toLowerCase()), text: (path) => files[path] ?? '' }
}

/** tsconfig.json's path aliases as [prefix, folder]: '@/*' to './src/*' is ['@/', 'src/']. */
function aliasesOf(root = REPO): readonly (readonly [string, string])[] {
  const read = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  const config = read.config as { compilerOptions?: { paths?: Record<string, string[]> } }
  return Object.entries(config.compilerOptions?.paths ?? {}).map(([key, targets]) => {
    const target = targets[0] ?? ''
    if (!key.endsWith('/*') || targets.length !== 1 || !target.endsWith('/*')) {
      throw new Error(`tsconfig paths: ${key} is not one 'x/*' to 'y/*', which the walk follows`)
    }
    return [key.slice(0, -1), posix.normalize(target.slice(0, -1))] as const
  })
}

const ALIASES = aliasesOf()

/**
 * What a script loads, by literal specifier: import and export from (type-only too),
 * import-equals, require() and import() (a string or a template without substitutions), and
 * import types.
 */
function specifiersOf(path: string, text: string): string[] {
  const kind = /\.tsx$/i.test(path)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(path)
      ? ts.ScriptKind.JSX
      : /\.[cm]?js$/i.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const found: string[] = []
  const take = (node: ts.Node | undefined): void => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      found.push(node.text)
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      take(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      take(node.moduleReference.expression)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      take(node.arguments[0])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      take(node.argument.literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

type Resolved =
  { readonly file: string } | { readonly external: true } | { readonly problem: string }

const TS_FOR_JS: Readonly<Record<string, string>> = {
  js: '.ts',
  jsx: '.tsx',
  mjs: '.mts',
  cjs: '.cts',
}

/** The file `specifier` loads from `from`: relative, alias and index forms; a package is external. */
function resolveFrom(
  from: string,
  specifier: string,
  files: RepoFiles,
  aliases: readonly (readonly [string, string])[],
): Resolved {
  const spec = specifier.replace(/\\/g, '/')
  const alias = aliases.find(([prefix]) => spec.startsWith(prefix))
  let base: string
  if (alias !== undefined) base = alias[1] + spec.slice(alias[0].length)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    base = posix.join(posix.dirname(from), spec)
  } else if (spec.startsWith('/') || /^[a-z]:\//i.test(spec) || /^file:/i.test(spec)) {
    return { problem: `loads '${specifier}' by an absolute path or URL` }
  } else return { external: true }
  const stem = posix.normalize(base).replace(/\/$/, '')
  if (stem === '..' || stem.startsWith('../')) {
    return { problem: `loads '${specifier}', outside the repository` }
  }
  const swapped = stem.replace(
    /\.(js|jsx|mjs|cjs)$/i,
    (whole, ext: string) => TS_FOR_JS[ext.toLowerCase()] ?? whole,
  )
  for (const candidate of [
    stem,
    swapped,
    ...LOADABLE.map((ext) => stem + ext),
    ...LOADABLE.map((ext) => `${stem}/index${ext}`),
  ]) {
    const file = files.find(candidate)
    if (file !== undefined) return { file }
  }
  return { problem: `cannot follow '${specifier}'` }
}

/** Each file `entry` loads, directly or through others, with the file that first loaded it. */
function reachOf(
  entry: string,
  files: RepoFiles,
  aliases: readonly (readonly [string, string])[],
  cache: Map<string, string[]>,
): { parents: Map<string, string | null>; problems: string[] } {
  const parents = new Map<string, string | null>([[entry, null]])
  const problems: string[] = []
  const queue = [entry]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (!WALKED.test(file)) continue
    let specifiers = cache.get(file)
    if (specifiers === undefined) {
      specifiers = specifiersOf(file, files.text(file))
      cache.set(file, specifiers)
    }
    for (const specifier of specifiers) {
      const resolved = resolveFrom(file, specifier, files, aliases)
      if ('external' in resolved) continue
      if ('problem' in resolved) {
        problems.push(`${file}: ${resolved.problem}`)
        continue
      }
      if (!parents.has(resolved.file)) {
        parents.set(resolved.file, file)
        queue.push(resolved.file)
      }
    }
  }
  return { parents, problems }
}

/** The e2e entries among `paths`: every loadable file under e2e/, and the Playwright config. */
const reachEntries = (paths: readonly string[]): string[] =>
  paths.filter(
    (path) =>
      (path.toLowerCase().startsWith('e2e/') && WALKED.test(path)) ||
      path.toLowerCase() === 'playwright.config.ts',
  )

/**
 * What the walk reports: an entry that reaches a builder it is not held to (with the chain), and
 * what it could not follow from an entry (fail closed).
 */
function reachFindings(
  entries: readonly string[],
  files: RepoFiles,
  aliases: readonly (readonly [string, string])[] = ALIASES,
): string[] {
  const findings = new Set<string>()
  const cache = new Map<string, string[]>()
  for (const entry of entries) {
    const { parents, problems } = reachOf(entry, files, aliases, cache)
    for (const problem of problems) findings.add(`${problem} (reached from ${entry})`)
    for (const fence of REACH_FENCES) {
      const hit = [...parents.keys()].find((file) => file.toLowerCase() === fence.file)
      if (hit === undefined || fence.entries.has(entry)) continue
      const chain: string[] = []
      for (let file: string | null | undefined = hit; file; file = parents.get(file)) {
        chain.unshift(file)
      }
      findings.add(`${entry}: loads the ${fence.name} module (${chain.join(' > ')})`)
    }
  }
  return [...findings]
}

/** The real repository's entries: every file under e2e/ (any depth) and playwright.config.ts. */
const realReachEntries = (): string[] =>
  reachEntries([...e2eFiles().map((file) => `e2e/${file.path}`), 'playwright.config.ts'])

// The picture scan's samples (C11, F2, the 10e reviews), shared with the narrated id's scan below.

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

/** [label, path, text]: each holds the picture story's id as a literal. */
const LITERAL_SAMPLES: readonly (readonly [string, string, string])[] = [
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
  ['a regex literal, hyphens escaped', 'player.spec.ts', 'const re = /river\\-stones\\-pictures/'],
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
]

/** [label, text]: each names the id outside the two files. */
const NAME_SAMPLES: readonly (readonly [string, string])[] = [
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
]

/** [label, text]: each refers to the id's module outside the two files. */
const MODULE_SAMPLES: readonly (readonly [string, string])[] = [
  ['a namespace import', "import * as ids from '../scripts/testing/picture-story-id'"],
  ['a dynamic import', "const ids = await import('../scripts/testing/picture-story-id')"],
  ['a require', "const ids = require('../scripts/testing/picture-story-id')"],
  ['an escaped specifier', "import * as ids from '../scripts/testing/picture\\u002dstory-id'"],
  ['a re-export', "export * from '../scripts/testing/picture-story-id'"],
  // Catalogue class 3 (letter case): Windows resolves a module path in any case.
  ['an upper-case specifier', "import * as ids from '../scripts/testing/PICTURE-STORY-ID'"],
]

/** [label, path, text]: each holds the id where the scan cannot read escapes (not a script). */
const NOT_SCRIPT_SAMPLES: readonly (readonly [string, string, string])[] = [
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
]

/** [label, path, text]: R2-guards-1, TypeScript and Playwright read JSX in .js, .mjs, .cjs too. */
const JSX_SAMPLES: readonly (readonly [string, string, string])[] = [
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
]

/** [label, regex, finding]: a regex literal that holds the name or the module escaped. */
const REGEX_SAMPLES: readonly (readonly [string, string, string])[] = [
  ['the name', '/PICTURE\\_STORY\\_ID/', 'player.spec.ts: names PICTURE_STORY_ID'],
  ['the module', '/picture\\-story\\-id/', 'player.spec.ts: refers to the picture-story-id module'],
]

/** [label, path]: only the two files by exact name may name the id. */
const EXACT_NAME_SAMPLES: readonly (readonly [string, string])[] = [
  ['upper-case routes', 'Routes.ts'],
  ['routes in a subfolder', 'sub/routes.ts'],
  ['the images spec in a subfolder', 'sub/player-images.spec.ts'],
  ['the images spec as .mts', 'player-images.spec.mts'],
]

/** [label, routes.ts text, finding]: routes.ts other than its import and one template. */
const ROUTES_SAMPLES: readonly (readonly [string, string, string])[] = [
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
]

/** [label, path, text]: the picture story's builder module outside the images spec. */
const PICTURE_BUILDER_SAMPLES: readonly (readonly [string, string, string])[] = [
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
  [
    'an upper-case specifier',
    'player.spec.ts',
    "import * as c from '../scripts/testing/STAGING-CATALOGUE'",
  ],
]

/**
 * The picture samples with the narrated story's names: the id (and its percent-encoded tail), the
 * name, the module and the naming spec. narratedSamplesHold proves none is left behind.
 */
function toNarrated(text: string): string {
  return text
    .replaceAll('%70%69%63%74%75%72%65%73', '%6e%61%72%72%61%74%65%64')
    .replaceAll('pictures', 'narrated')
    .replaceAll('PICTURES', 'NARRATED')
    .replaceAll('PICTURE', 'NARRATION')
    .replaceAll('picture', 'narration')
    .replaceAll('player-images.spec', 'player-audio.spec')
}

const narratedRows = <T extends readonly string[]>(rows: readonly T[]): T[] =>
  rows.map((row) => row.map(toNarrated) as unknown as T)

const N_ROUTES = toNarrated(ROUTES)
const AUDIO_SPEC = [
  "import { NARRATION_STORY_ID } from '../scripts/testing/narration-story-id'",
  "import { narrationClipPath } from '../scripts/testing/narration-story'",
  'const url = `/en/stories/${NARRATION_STORY_ID}/read`',
  'const hi = `/hi/stories/${NARRATION_STORY_ID}/read`',
].join('\n')
const MEDIA_HELPERS = [
  "import { NARRATION_CLIP, narrationClipPath } from '../scripts/testing/narration-story'",
  'export const clipUrl = (node: string, code: string) => narrationClipPath(node, code)',
].join('\n')

/** [label, path, text]: the narrated story's builder module outside its two files. */
const NARRATION_BUILDER_SAMPLES: readonly (readonly [string, string, string])[] = [
  [
    'a named import',
    'player.spec.ts',
    "import { narrationClipPath } from '../scripts/testing/narration-story'",
  ],
  [
    'a dynamic import',
    'player.spec.ts',
    "const c = await import('../scripts/testing/narration-story')",
  ],
  [
    'an escaped specifier',
    'player.spec.ts',
    "import * as c from '../scripts/testing/narration\\u002dstory'",
  ],
  [
    'a require',
    'player.spec.ts',
    "const { narrationClipPath } = require('../scripts/testing/narration-story.ts')",
  ],
  [
    'in routes.ts',
    'routes.ts',
    `${N_ROUTES}\nimport { narrationClipPath } from '../scripts/testing/narration-story'`,
  ],
  [
    'an upper-case specifier',
    'player.spec.ts',
    "import * as c from '../scripts/testing/NARRATION-STORY'",
  ],
  [
    'a guard spec',
    'security-guard.spec.ts',
    "import { NARRATION_CLIP } from '../scripts/testing/narration-story'",
  ],
]

/**
 * [label, path, text]: the media helpers (they export the built clip URLs) outside the narration
 * spec (review round 1, S11-R1-FS-2): the catalogue's specifier forms, plus the two e2e files that
 * once could, the guard spec and routes.ts.
 */
const NARRATION_MEDIA_SAMPLES: readonly (readonly [string, string, string])[] = [
  ['a named import', 'player.spec.ts', "import { CLIP_URLS } from './narration-media'"],
  ['a dynamic import', 'player.spec.ts', "const m = await import('./narration-media')"],
  ['an escaped specifier', 'player.spec.ts', "import * as m from './narration\\u002dmedia'"],
  ['a require', 'player.spec.ts', "const { clipUrl } = require('./narration-media.ts')"],
  ['an upper-case specifier', 'player.spec.ts', "import * as m from './NARRATION-MEDIA'"],
  ['a guard spec', 'security-guard.spec.ts', "import { clipUrl } from './narration-media'"],
  ['in routes.ts', 'routes.ts', `${N_ROUTES}\nimport { CLIP_URLS } from './narration-media'`],
  [
    'the media answer re-exporting it',
    'media-answer.ts',
    "export { CLIP_URLS } from './narration-media'",
  ],
]

/**
 * [label, files]: the media answer loading the clip builder (review round 2, S11-R2-FS-1). The
 * guard spec may import the media answer, so the answer may not load narration-story at all: a
 * re-export or a wrapper of the clip-path builder would hand any spec a real media-origin clip
 * URL (catalogue lint class 12, the import fence through a helper module). It takes the clip's
 * bytes from the leaf silent-mp3 module instead.
 */
const MEDIA_ANSWER_SAMPLES: readonly (readonly [string, readonly ScanFile[]])[] = [
  [
    "the bytes from narration-story (the round-1 file's import)",
    [
      {
        path: 'media-answer.ts',
        text: "import { NARRATION_CLIP } from '../scripts/testing/narration-story'",
      },
    ],
  ],
  [
    'a named re-export of the builder, which the guard spec turns into a clip URL',
    [
      {
        path: 'media-answer.ts',
        text: "export { narrationClipPath, NARRATION_CLIPS } from '../scripts/testing/narration-story'",
      },
      {
        path: 'security-guard.spec.ts',
        text: [
          "import { CONTENT_PUBLIC_BASE } from '../src/config/security-headers'",
          "import { narrationClipPath } from './media-answer'",
          "const url = `${CONTENT_PUBLIC_BASE}/${narrationClipPath('start', 'en')}`",
        ].join('\n'),
      },
    ],
  ],
  [
    'export *',
    [{ path: 'media-answer.ts', text: "export * from '../scripts/testing/narration-story'" }],
  ],
  [
    'a wrapping export',
    [
      {
        path: 'media-answer.ts',
        text: [
          "import { narrationClipPath } from '../scripts/testing/narration-story'",
          "export const probePath = (node: string) => narrationClipPath(node, 'en')",
        ].join('\n'),
      },
    ],
  ],
  [
    'a dynamic import',
    [
      {
        path: 'media-answer.ts',
        text: "export const story = () => import('../scripts/testing/narration-story')",
      },
    ],
  ],
  [
    'a require',
    [
      {
        path: 'media-answer.ts',
        text: "export const story = require('../scripts/testing/narration-story.ts')",
      },
    ],
  ],
  [
    'an escaped specifier',
    [
      {
        path: 'media-answer.ts',
        text: "export * from '../scripts/testing/narration\\u002dstory'",
      },
    ],
  ],
  [
    'an upper-case specifier',
    [{ path: 'media-answer.ts', text: "export * from '../scripts/testing/NARRATION-STORY'" }],
  ],
]

/**
 * The reach walk's repository (review round 3, S11-R3-FS-1): the allowed shape, written out, with
 * near-misses (the id modules, a neighbouring name, packages, a CSS module, a comment and a string
 * that load nothing).
 */
const REACH_BASE: Readonly<Record<string, string>> = {
  'playwright.config.ts': "import { launchLeg } from './e2e/launch-leg'",
  'e2e/launch-leg.ts': 'export const launchLeg = (leg: string) => leg',
  'e2e/player-audio.spec.ts': [
    "import { clipUrl } from './narration-media'",
    "import { NARRATION_CLIP } from '../scripts/testing/narration-story'",
    "import { SETTLE_MS } from '../src/reader/player/view'",
  ].join('\n'),
  'e2e/narration-media.ts': [
    "import { narrationClipPath } from '../scripts/testing/narration-story'",
    'export const clipUrl = narrationClipPath',
  ].join('\n'),
  'e2e/media-answer.ts': "import { silentMp3 } from '../scripts/testing/silent-mp3'",
  'e2e/security-guard.spec.ts': [
    "import { mediaAllows } from './media-answer'",
    "import { MEDIA_ORIGIN } from '../src/config/security-headers'",
    '// not ../scripts/testing/narration-story',
  ].join('\n'),
  'e2e/routes.ts': [
    "import { NARRATION_STORY_ID } from '../scripts/testing/narration-story-id'",
    "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'",
  ].join('\n'),
  'e2e/player.spec.ts': [
    "import { test } from '@playwright/test'",
    "import { readFileSync } from 'node:fs'",
    "import { playerNotFoundPaths } from './routes'",
    "import { near } from '../scripts/testing/narration-stories'",
    "const named = '../scripts/testing/narration-story'",
  ].join('\n'),
  'e2e/player-images.spec.ts':
    "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'",
  'scripts/testing/narration-story.ts': [
    "import { NARRATION_STORY_ID } from './narration-story-id'",
    "import { silentMp3 } from './silent-mp3'",
    'export const narrationClipPath = (node: string) => node',
  ].join('\n'),
  'scripts/testing/narration-story-id.ts': "export const NARRATION_STORY_ID = 'x'",
  'scripts/testing/picture-story-id.ts': "export const PICTURE_STORY_ID = 'y'",
  'scripts/testing/silent-mp3.ts': 'export const silentMp3 = (frames: number) => frames',
  'scripts/testing/staging-catalogue.ts': "import { narrationClipPath } from './narration-story'",
  'scripts/testing/narration-stories.ts': 'export const near = 1',
  'src/reader/player/view.ts': [
    "import styles from './view.module.css'",
    'export const SETTLE_MS = 500',
  ].join('\n'),
  'src/reader/player/view.module.css': '.x {}',
  'src/config/security-headers.ts': "export const MEDIA_ORIGIN = 'https://media.example'",
}

/** A wrapper of the clip builder outside e2e/, as most reach samples use it. */
const CLIPS = { 'scripts/testing/clips.ts': "export * from './narration-story'" }
const CLIPS_CHAIN = 'scripts/testing/clips.ts > scripts/testing/narration-story.ts'
const SPEC = 'e2e/player.spec.ts'

/** [label, files over REACH_BASE, the finding]: one per bypass form the walk must follow. */
const REACH_SAMPLES: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  [
    'an export * wrapper in scripts/testing, imported by the guard spec',
    {
      ...CLIPS,
      'e2e/security-guard.spec.ts': [
        "import { mediaAllows } from './media-answer'",
        "import { narrationClipPath } from '../scripts/testing/clips'",
      ].join('\n'),
    },
    `e2e/security-guard.spec.ts: loads the narration-story module (e2e/security-guard.spec.ts > ${CLIPS_CHAIN})`,
  ],
  [
    'a src/ wrapper: a named re-export',
    {
      'src/reader/clips.ts':
        "export { narrationClipPath } from '../../scripts/testing/narration-story'",
      [SPEC]: "import { narrationClipPath } from '../src/reader/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > src/reader/clips.ts > scripts/testing/narration-story.ts)`,
  ],
  [
    'a wrapper of the e2e media helpers',
    {
      'scripts/testing/media-wrap.ts': "export { clipUrl } from '../../e2e/narration-media'",
      [SPEC]: "import { clipUrl } from '../scripts/testing/media-wrap'",
    },
    `${SPEC}: loads the narration-media module (${SPEC} > scripts/testing/media-wrap.ts > e2e/narration-media.ts)`,
  ],
  [
    'two hops',
    {
      'scripts/a.ts': "export * from './b'",
      'scripts/b.ts': [
        "import { narrationClipPath } from './testing/narration-story'",
        'export const clip = narrationClipPath',
      ].join('\n'),
      [SPEC]: "import { clip } from '../scripts/a'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > scripts/a.ts > scripts/b.ts > scripts/testing/narration-story.ts)`,
  ],
  [
    'a dynamic import of a wrapper',
    { ...CLIPS, [SPEC]: "const clips = await import('../scripts/testing/clips')" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'a template-literal specifier',
    { ...CLIPS, [SPEC]: 'const clips = await import(`../scripts/testing/clips`)' },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'a require of a wrapper, with its extension',
    { ...CLIPS, [SPEC]: "const clips = require('../scripts/testing/clips.ts')" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'an import-equals of a wrapper',
    { ...CLIPS, [SPEC]: "import clips = require('../scripts/testing/clips')" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'an import type',
    { ...CLIPS, [SPEC]: "type Clip = import('../scripts/testing/clips').Clip" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'a type-only re-export (the fence holds the module, not only its values)',
    {
      'scripts/testing/clips.ts': "export type { NarrationClip } from './narration-story'",
      [SPEC]: "import type { NarrationClip } from '../scripts/testing/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'the tsconfig alias',
    {
      'src/reader/clips.ts': "export * from '../../scripts/testing/narration-story'",
      [SPEC]: "import { narrationClipPath } from '@/reader/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > src/reader/clips.ts > scripts/testing/narration-story.ts)`,
  ],
  [
    'an index module',
    {
      'scripts/clips/index.ts': "export * from '../testing/narration-story'",
      [SPEC]: "import * as clips from '../scripts/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > scripts/clips/index.ts > scripts/testing/narration-story.ts)`,
  ],
  [
    'a .js specifier for a .ts wrapper',
    { ...CLIPS, [SPEC]: "import * as clips from '../scripts/testing/clips.js'" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'an .mts wrapper by its .mjs name',
    {
      'scripts/testing/clips.mts': "export * from './narration-story.js'",
      [SPEC]: "import * as clips from '../scripts/testing/clips.mjs'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > scripts/testing/clips.mts > scripts/testing/narration-story.ts)`,
  ],
  [
    'a .cjs wrapper that requires it',
    {
      'scripts/testing/clips.cjs': "module.exports = require('./narration-story')",
      [SPEC]: "const clips = require('../scripts/testing/clips.cjs')",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > scripts/testing/clips.cjs > scripts/testing/narration-story.ts)`,
  ],
  [
    'a .jsx wrapper',
    {
      'src/clips.jsx':
        "export * from '../scripts/testing/narration-story'\nexport const A = () => <p />",
      [SPEC]: "import * as clips from '../src/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > src/clips.jsx > scripts/testing/narration-story.ts)`,
  ],
  [
    'an escaped specifier in the wrapper',
    {
      'scripts/testing/clips.ts': "export * from './narration\\u002dstory'",
      [SPEC]: "import * as clips from '../scripts/testing/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'an upper-case specifier in the wrapper',
    {
      'scripts/testing/clips.ts': "export * from './NARRATION-STORY'",
      [SPEC]: "import * as clips from '../scripts/testing/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'an upper-case wrapper file',
    {
      'scripts/testing/Clips.TS': "export * from './narration-story'",
      [SPEC]: "import * as clips from '../scripts/testing/clips'",
    },
    `${SPEC}: loads the narration-story module (${SPEC} > scripts/testing/Clips.TS > scripts/testing/narration-story.ts)`,
  ],
  [
    'backslash separators',
    { ...CLIPS, [SPEC]: "import * as clips from '..\\\\scripts\\\\testing\\\\clips'" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    "'.' and '..' segments",
    { ...CLIPS, [SPEC]: "import * as clips from '../scripts/./testing/../testing/clips/'" },
    `${SPEC}: loads the narration-story module (${SPEC} > ${CLIPS_CHAIN})`,
  ],
  [
    'the Playwright config',
    {
      ...CLIPS,
      'playwright.config.ts': [
        "import { launchLeg } from './e2e/launch-leg'",
        "import './scripts/testing/clips'",
      ].join('\n'),
    },
    `playwright.config.ts: loads the narration-story module (playwright.config.ts > ${CLIPS_CHAIN})`,
  ],
  [
    'a nested e2e helper',
    { ...CLIPS, 'e2e/helpers/deep/clip.mts': "export * from '../../../scripts/testing/clips'" },
    `e2e/helpers/deep/clip.mts: loads the narration-story module (e2e/helpers/deep/clip.mts > ${CLIPS_CHAIN})`,
  ],
  [
    'the media answer through a wrapper (reached from the guard spec)',
    {
      'scripts/testing/bytes.ts': "export { NARRATION_CLIP } from './narration-story'",
      'e2e/media-answer.ts': "import { NARRATION_CLIP } from '../scripts/testing/bytes'",
    },
    'e2e/security-guard.spec.ts: loads the narration-story module (e2e/security-guard.spec.ts > e2e/media-answer.ts > scripts/testing/bytes.ts > scripts/testing/narration-story.ts)',
  ],
  [
    'the staging catalogue (the picture rule) through a src/ wrapper',
    {
      'src/catalogue.ts': "export * from '../scripts/testing/staging-catalogue'",
      [SPEC]: "import * as catalogue from '../src/catalogue'",
    },
    `${SPEC}: loads the staging-catalogue module (${SPEC} > src/catalogue.ts > scripts/testing/staging-catalogue.ts)`,
  ],
  [
    'the images spec loading the catalogue reaches the clip builder through it',
    {
      'e2e/player-images.spec.ts':
        "import { pictureStoryOf } from '../scripts/testing/staging-catalogue'",
    },
    'e2e/player-images.spec.ts: loads the narration-story module (e2e/player-images.spec.ts > scripts/testing/staging-catalogue.ts > scripts/testing/narration-story.ts)',
  ],
  [
    'fail closed: a specifier the walk cannot find',
    {
      'scripts/testing/clips.ts': "export * from './gone'",
      [SPEC]: "import * as clips from '../scripts/testing/clips'",
    },
    `scripts/testing/clips.ts: cannot follow './gone' (reached from ${SPEC})`,
  ],
  [
    'fail closed: a file outside the repository',
    { [SPEC]: "import * as clips from '../../elsewhere/clips'" },
    `${SPEC}: loads '../../elsewhere/clips', outside the repository (reached from ${SPEC})`,
  ],
  [
    'fail closed: an absolute path',
    { [SPEC]: "import * as clips from 'D:/repo/scripts/testing/clips'" },
    `${SPEC}: loads 'D:/repo/scripts/testing/clips' by an absolute path or URL (reached from ${SPEC})`,
  ],
  [
    'fail closed: a file URL',
    { [SPEC]: "const clips = await import('file:///repo/scripts/testing/clips.ts')" },
    `${SPEC}: loads 'file:///repo/scripts/testing/clips.ts' by an absolute path or URL (reached from ${SPEC})`,
  ],
]

/** The reach walk over REACH_BASE with `extra` files laid over it. */
const reachSample = (extra: Readonly<Record<string, string>> = {}): string[] => {
  const files = { ...REACH_BASE, ...extra }
  return reachFindings(reachEntries(Object.keys(files)), textFiles(files))
}

describe('the picture story id in e2e/ (design §9.1 G4, §9.2, C11, F2)', () => {
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

  it.each(LITERAL_SAMPLES)('rejects the literal: %s', (_label, path, text) => {
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

  it.each(NAME_SAMPLES)('rejects naming it outside the two files: %s', (_label, text) => {
    expect(scan({ path: 'player.spec.ts', text })).toContain(
      'player.spec.ts: names PICTURE_STORY_ID',
    )
  })

  it.each(MODULE_SAMPLES)('rejects the module outside the two files: %s', (_label, text) => {
    expect(scan({ path: 'helpers.ts', text })).toContain(
      'helpers.ts: refers to the picture-story-id module',
    )
  })

  it.each(PICTURE_BUILDER_SAMPLES)(
    'rejects the staging-catalogue module (it builds the picture story) outside the images spec: %s',
    (_label, path, text) => {
      const findings = path === 'routes.ts' ? withRoutes(text) : scan({ path, text })
      expect(findings).toContain(`${path}: refers to the staging-catalogue module`)
    },
  )

  it.each(NOT_SCRIPT_SAMPLES)('rejects a file that is not a script: %s', (_label, path, text) => {
    expect(scan({ path, text })).toContain(
      `${path}: is not a script, so the scan cannot read its escapes`,
    )
  })

  it.each(JSX_SAMPLES)('rejects a script that holds JSX: %s', (_label, path, text) => {
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

  it.each(REGEX_SAMPLES)(
    'rejects a regex literal that holds %s escaped',
    (_label, regex, finding) => {
      expect(scan({ path: 'player.spec.ts', text: `const re = ${regex}` })).toContain(finding)
    },
  )

  it('accepts regex literals with escapes that do not hold the id', () => {
    expect(
      scan({
        path: 'player.spec.ts',
        text: 'const re = /\\/stories\\/[^/]+\\/read$/\nconst near = /river\\-stones\\/read/',
      }),
    ).toEqual([])
  })

  it.each(EXACT_NAME_SAMPLES)('allows only the two files by exact name: %s', (_label, path) => {
    expect(scan({ path, text: IMAGES_SPEC })).toContain(`${path}: names PICTURE_STORY_ID`)
  })

  it.each(ROUTES_SAMPLES)(
    'rejects routes.ts other than its import and one template: %s',
    (_label, text, finding) => {
      expect(withRoutes(text)).toContain(finding)
    },
  )
})

describe('the narrated story id in e2e/ (design p1-step11 §3.23, A36, T11-24)', () => {
  const scan = (...extra: ScanFile[]) =>
    narratedIdFindings([
      { path: 'routes.ts', text: N_ROUTES },
      { path: 'player-audio.spec.ts', text: AUDIO_SPEC },
      ...extra,
    ])
  const withRoutes = (text: string) =>
    narratedIdFindings([
      { path: 'routes.ts', text },
      { path: 'player-audio.spec.ts', text: AUDIO_SPEC },
    ])

  it('the real e2e/ folder holds to it: only player-audio.spec.ts and routes.ts name the id', () => {
    const files = e2eFiles()
    const paths = files.map((file) => file.path)
    // Not vacuous: the scan reads the files the narration work added, routes.ts among them.
    for (const path of [
      'routes.ts',
      'player-audio.spec.ts',
      'narration-media.ts',
      'media-answer.ts',
      'security-guard.spec.ts',
    ]) {
      expect(paths, `precondition: the scan reads e2e/${path}`).toContain(path)
    }
    expect(narratedIdFindings(files)).toEqual([])
    const naming = files
      .filter((file) => new RegExp(`\\b${NARRATION_RULE.name}\\b`).test(file.text))
      .map((file) => file.path)
      .sort()
    expect(naming, 'the files that name it').toEqual(['player-audio.spec.ts', 'routes.ts'])
  })

  it('the narrated samples are the picture samples with every picture name replaced', () => {
    const rows = [
      ...narratedRows(LITERAL_SAMPLES),
      ...narratedRows(NAME_SAMPLES),
      ...narratedRows(MODULE_SAMPLES),
      ...narratedRows(NOT_SCRIPT_SAMPLES),
      ...narratedRows(JSX_SAMPLES),
      ...narratedRows(REGEX_SAMPLES),
      ...narratedRows(EXACT_NAME_SAMPLES),
      ...narratedRows(ROUTES_SAMPLES),
      [N_ROUTES],
    ]
    for (const row of rows) {
      for (const cell of row) {
        expect(cell, 'no picture name is left behind').not.toMatch(/pictur|images\.spec|%70%69%63/i)
      }
    }
    expect(N_ROUTES).toContain(
      "import { NARRATION_STORY_ID } from '../scripts/testing/narration-story-id'",
    )
    expect(narratedRows(LITERAL_SAMPLES)[7]?.[2]).toBe(
      "page.goto('/en/stories/%72%69%76%65%72%2d%73%74%6f%6e%65%73%2d%6e%61%72%72%61%74%65%64/read')",
    )
    expect(percentDecoded(narratedRows(LITERAL_SAMPLES)[7]?.[2] ?? '')).toContain(NARRATED_ID)
  })

  it('accepts the allowed shape and near-misses: the media helpers may load the clip builder', () => {
    expect(scan()).toEqual([])
    expect(
      scan(
        {
          path: 'player.spec.ts',
          text: "page.goto('/en/stories/river-stones/read') // the narrated story is elsewhere\nconst NARRATION_STORY_IDS = 1",
        },
        { path: 'narration-media.ts', text: MEDIA_HELPERS },
      ),
    ).toEqual([])
    // The media answer takes the clip's bytes from the leaf silent-mp3 module (review round 2,
    // S11-R2-FS-1); the guard spec takes the answer from it, and a comment that names the helpers
    // or the builder loads nothing (review round 1, S11-R1-FS-2).
    expect(
      scan(
        {
          path: 'media-answer.ts',
          text: [
            "import { silentMp3 } from '../scripts/testing/silent-mp3'",
            '// the same 42 frames as narration-story.ts NARRATION_CLIP',
            'const PROBE_CLIP = silentMp3(42)',
          ].join('\n'),
        },
        {
          path: 'security-guard.spec.ts',
          text: "import { mediaAllows } from './media-answer'\n// not e2e/narration-media.ts",
        },
      ),
    ).toEqual([])
  })

  it.each(narratedRows(LITERAL_SAMPLES))('rejects the literal: %s', (_label, path, text) => {
    const findings =
      path === 'player-audio.spec.ts'
        ? narratedIdFindings([
            { path: 'routes.ts', text: N_ROUTES },
            { path, text },
          ])
        : scan({ path, text })
    expect(findings).toContain(`${path}: holds the narrated story id as a literal`)
  })

  it('rejects the literal in routes.ts and in the media helpers', () => {
    expect(withRoutes(`${N_ROUTES}\nconst x = '/en/stories/river-stones-narrated/read'`)).toContain(
      'routes.ts: holds the narrated story id as a literal',
    )
    expect(
      scan({ path: 'narration-media.ts', text: `${MEDIA_HELPERS}\n// river-stones-narrated` }),
    ).toContain('narration-media.ts: holds the narrated story id as a literal')
  })

  it.each(narratedRows(NAME_SAMPLES))(
    'rejects naming it outside the two files: %s',
    (_label, text) => {
      expect(scan({ path: 'player.spec.ts', text })).toContain(
        'player.spec.ts: names NARRATION_STORY_ID',
      )
    },
  )

  it('rejects naming it in the media helpers, even in a comment', () => {
    expect(
      scan({ path: 'narration-media.ts', text: `${MEDIA_HELPERS}\n// NARRATION_STORY_ID` }),
    ).toContain('narration-media.ts: names NARRATION_STORY_ID')
  })

  it.each(narratedRows(MODULE_SAMPLES))(
    'rejects the module outside the two files: %s',
    (_label, text) => {
      expect(scan({ path: 'helpers.ts', text })).toContain(
        'helpers.ts: refers to the narration-story-id module',
      )
    },
  )

  it.each(NARRATION_BUILDER_SAMPLES)(
    'rejects the narration-story module (it builds the clip paths) outside its two files: %s',
    (_label, path, text) => {
      const findings = path === 'routes.ts' ? withRoutes(text) : scan({ path, text })
      expect(findings).toContain(`${path}: refers to the narration-story module`)
    },
  )

  it.each(NARRATION_MEDIA_SAMPLES)(
    'rejects the narration-media module (it exports the clip URLs) outside the narration spec: %s',
    (_label, path, text) => {
      const findings = path === 'routes.ts' ? withRoutes(text) : scan({ path, text })
      expect(findings).toContain(`${path}: refers to the narration-media module`)
    },
  )

  it.each(MEDIA_ANSWER_SAMPLES)(
    'rejects the narration-story module in the media answer, which the guard spec may load: %s',
    (_label, files) => {
      expect(scan(...files)).toContain('media-answer.ts: refers to the narration-story module')
    },
  )

  it.each(narratedRows(NOT_SCRIPT_SAMPLES))(
    'rejects a file that is not a script: %s',
    (_label, path, text) => {
      expect(scan({ path, text })).toContain(
        `${path}: is not a script, so the scan cannot read its escapes`,
      )
    },
  )

  it.each(narratedRows(JSX_SAMPLES))(
    'rejects a script that holds JSX: %s',
    (_label, path, text) => {
      expect(scan({ path, text })).toContain(
        `${path}: holds JSX, whose character references the scan cannot read`,
      )
    },
  )

  it.each(narratedRows(REGEX_SAMPLES))(
    'rejects a regex literal that holds %s escaped',
    (_label, regex, finding) => {
      expect(scan({ path: 'player.spec.ts', text: `const re = ${regex}` })).toContain(finding)
    },
  )

  it.each(narratedRows(EXACT_NAME_SAMPLES))(
    'allows only the two files by exact name: %s',
    (_label, path) => {
      expect(scan({ path, text: AUDIO_SPEC })).toContain(`${path}: names NARRATION_STORY_ID`)
    },
  )

  it.each(narratedRows(ROUTES_SAMPLES))(
    'rejects routes.ts other than its import and one template: %s',
    (_label, text, finding) => {
      expect(withRoutes(text)).toContain(finding)
    },
  )

  it('routes.ts may hold both ids, each named exactly twice (the real file shape)', () => {
    const both = [
      "import { NARRATION_STORY_ID } from '../scripts/testing/narration-story-id'",
      "import { PICTURE_STORY_ID } from '../scripts/testing/picture-story-id'",
      'export function playerNotFoundPaths(leg: string): string[] {',
      "  if (leg === 'staging') return []",
      '  return [`/en/stories/${PICTURE_STORY_ID}/read`, `/en/stories/${NARRATION_STORY_ID}/read`]',
      '}',
    ].join('\n')
    expect(
      pictureIdFindings([
        { path: 'routes.ts', text: both },
        { path: 'player-images.spec.ts', text: IMAGES_SPEC },
      ]),
    ).toEqual([])
    expect(withRoutes(both)).toEqual([])
  })
})

describe('what each e2e entry loads, followed across the repository (review round 3, S11-R3-FS-1; lint class 12)', () => {
  it('reads the tsconfig aliases it follows', () => {
    expect(ALIASES).toEqual([['@/', 'src/']])
  })

  it('the real repository holds to it: each builder reached only from its own entries', () => {
    const entries = realReachEntries()
    // Not vacuous: the walk reads the entries the narration work added and the config, and from
    // them reaches the builders through the files that may load them.
    for (const path of [
      'e2e/player-audio.spec.ts',
      'e2e/narration-media.ts',
      'e2e/media-answer.ts',
      'e2e/security-guard.spec.ts',
      'e2e/routes.ts',
      'playwright.config.ts',
    ]) {
      expect(entries, `precondition: the walk starts at ${path}`).toContain(path)
    }
    const files = repoFiles()
    const cache = new Map<string, string[]>()
    const audio = reachOf('e2e/player-audio.spec.ts', files, ALIASES, cache).parents
    expect(audio.get('scripts/testing/narration-story.ts'), 'the spec loads the builder').toBe(
      'e2e/player-audio.spec.ts',
    )
    expect(audio.get('e2e/narration-media.ts'), 'and the media helpers').toBe(
      'e2e/player-audio.spec.ts',
    )
    expect(
      [...audio.keys()].some((file) => file.startsWith('src/')),
      'the walk follows into src/',
    ).toBe(true)
    const guard = reachOf('e2e/security-guard.spec.ts', files, ALIASES, cache).parents
    expect(guard.get('scripts/testing/silent-mp3.ts'), 'the guard spec reaches silent-mp3').toBe(
      'e2e/media-answer.ts',
    )
    expect(reachFindings(entries, files)).toEqual([])
  })

  it('accepts the allowed shape and near-misses', () => {
    expect(reachSample()).toEqual([])
  })

  it.each(REACH_SAMPLES)(
    'rejects a builder reached through another module: %s',
    (_l, extra, finding) => {
      expect(reachSample(extra)).toContain(finding)
    },
  )
})
