// Step 14 (P1-8c) story-checks.ts and stage-testkit.ts: the per-story local checks shared by
// validate and stage (design migration-input/p1-step14-design.md §4.2, D14-2 to D14-6, D14-26,
// §9 L1, L3, L7, L13; test plan §14.5: T14-16 to T14-24). vi.mock wraps checkPackage of
// src/core/content/packages in a vi.fn around the real one. Inputs are the testkit's phase-2
// stories written under an OS temp folder; nothing is written under the repository, and T14-16
// builds from a byte copy of fixtures/packages so even its write-back mutant touches only the copy.
// Titles start with their id; one expect.soft per claim, messages "(gN) <claim> <sample>";
// preconditions are hard expects starting "precondition:".
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as packages from '../../src/core/content/packages'
import { decodeJson, expectedPackagePath, isCanonicalJcs } from '../../src/core/content/gates'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import type { WaiverKeys } from '../../src/core/package/catalogue'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import type { PrivateRuleData } from '../../src/core/rules/types'
import { wordCount } from '../../src/core/validator/text'
import { WaiverFile, findingFingerprint } from '../../src/core/validator/waivers'
import {
  FIXTURE_PACKAGES_DIR,
  buildTestStories,
  waiverBytesOf,
  waiverFileOf,
  withPackage,
  writeStageInputs,
  type StageInputDirs,
  type TestStory,
} from './stage-testkit'
import {
  checkStories,
  checkStory,
  loadPrivateLists,
  validatorVerdict,
  type LocalStory,
} from './story-checks'

vi.mock('../../src/core/content/packages', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/content/packages')>()
  return { ...real, checkPackage: vi.fn(real.checkPackage) }
})
const checkPackageSpy = vi.mocked(packages.checkPackage)

const RULESET = PANCHATANTRA_RULESET
let root = ''
let cached: Promise<TestStory[]> | null = null
/** Built on first use inside a test, never in a hook, so T14-16 alone never reads fixtures/. */
const testStories = (): Promise<TestStory[]> => (cached ??= buildTestStories())

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 's14-sc-'))
  checkPackageSpy.mockClear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const sha = (bytes: Uint8Array<ArrayBuffer>) => sha256Hex(bytes)
const encode = (text: string) => new TextEncoder().encode(text)
const run = (id: string, dirs: StageInputDirs, privateData: PrivateRuleData | null = null) =>
  checkStory(id, { ...dirs, privateData })
const writePackage = (dirs: StageInputDirs, id: string, bytes: Uint8Array | string) =>
  writeFileSync(join(dirs.packagesDir, `${id}.json`), bytes)
const writeWaiver = (dirs: StageInputDirs, id: string, bytes: Uint8Array | string) =>
  writeFileSync(join(dirs.waiversDir, `${id}.json`), bytes)
const firstNonEnding = (pkg: StoryPackageV1): string =>
  pkg.nodes.find((node) => node.type !== 'ending')!.id
const edited = (pkg: StoryPackageV1, change: (copy: StoryPackageV1) => void): StoryPackageV1 => {
  const copy = structuredClone(pkg)
  change(copy)
  return copy
}
const enText = (pkg: StoryPackageV1, nodeId: string): string => pkg.text.en!.nodes[nodeId]!.text
const setEnText = (pkg: StoryPackageV1, nodeId: string, text: string) => {
  pkg.text.en!.nodes[nodeId]!.text = text
}
type Rec = WaiverFile['waivers'][number]
const rec = (
  checkId: string,
  nodeId: string | null,
  locale: 'en' | 'hi' | null,
  nodeTextSha256 = 'a'.repeat(64),
  extra: Partial<Rec> = {},
): Rec => ({ checkId, ruleId: null, nodeId, locale, severity: 'error', nodeTextSha256, ...extra })
/** The result without the package (its text holds whatever the test planted). */
const visible = (local: LocalStory | undefined): string =>
  JSON.stringify({ ...local, pkg: null, packageBytes: null })
const entryOf = (pkg: StoryPackageV1, packageSha256: string, block: WaiverKeys | null) => ({
  storyId: pkg.storyId,
  collectionId: pkg.collectionId,
  version: pkg.version,
  packagePath: expectedPackagePath({ storyId: pkg.storyId, packageSha256 }, 'staging', ''),
  packageSha256,
  ...(block ? { waivers: block } : {}),
})

describe('stage-testkit', () => {
  it('T14-16 the testkit builds valid phase-2 stories and never touches fixtures/ (A29)', async () => {
    const names = readdirSync(FIXTURE_PACKAGES_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
    const realSha = await Promise.all(
      names.map((name) => sha(new Uint8Array(readFileSync(join(FIXTURE_PACKAGES_DIR, name))))),
    )
    const copy = join(root, 'fixtures-copy')
    mkdirSync(copy)
    for (const name of names) copyFileSync(join(FIXTURE_PACKAGES_DIR, name), join(copy, name))
    expect(names.length, 'precondition: the three committed fixture packages').toBe(3)
    const built = await buildTestStories(copy)
    expect(built.length, 'precondition: one story per fixture').toBe(3)

    for (const story of built) {
      expect.soft(story.pkg.assets.length > 0, `(g1) has assets: ${story.storyId}`).toBe(true)
      const decoded = decodeJson(story.packageBytes, 'package')
      expect
        .soft(
          decoded.ok && isCanonicalJcs(decoded.value, story.packageBytes),
          `(g1) JCS: ${story.storyId}`,
        )
        .toBe(true)
      const block: WaiverKeys = {
        ruleSetRef: RULESET.ref,
        waiverFileSha256: story.waiverSha256,
        keys: [],
      }
      const verdict = await packages.checkPackage(
        story.packageBytes,
        entryOf(story.pkg, story.packageSha256, block),
        RULESET,
        { requireJcs: true },
      )
      expect.soft(verdict.ok, `(g1) passes the real checkPackage: ${story.storyId}`).toBe(true)
    }

    for (const story of built) {
      for (const media of story.media) {
        const hex = (media.path.split('/').pop() ?? '').slice(0, 64)
        expect
          .soft(hex, `(g2) path hex is its own sha256: ${media.path}`)
          .toBe(await sha(media.bytes))
      }
      const [w1, w2] = story.media
      expect
        .soft(
          w1 !== undefined &&
            w2 !== undefined &&
            w1.path !== w2.path &&
            (await sha(w1.bytes)) !== (await sha(w2.bytes)),
          `(g2) the two widths differ in bytes and name: ${story.storyId}`,
        )
        .toBe(true)
    }

    const afterCopy = await Promise.all(
      names.map((name) => sha(new Uint8Array(readFileSync(join(copy, name))))),
    )
    expect.soft(afterCopy, '(g3) the fixture files the testkit read are unchanged').toEqual(realSha)
    const again = await buildTestStories(copy)
    expect
      .soft(
        again.map((story) => story.packageSha256),
        '(g3) two builds give equal bytes',
      )
      .toEqual(built.map((story) => story.packageSha256))
    const afterReal = await Promise.all(
      names.map((name) => sha(new Uint8Array(readFileSync(join(FIXTURE_PACKAGES_DIR, name))))),
    )
    expect.soft(afterReal, '(g3) the committed fixtures are unchanged').toEqual(realSha)
  })
})

describe('story-checks: package, waiver and validator', () => {
  it('T14-17 package rules in order: JCS, strict parse, storyId, collection, phase 1 (A5)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const dirs = writeStageInputs(root, [story])
    expect((await run(id, dirs)).blocking, 'precondition: the testkit story passes').toBeNull()
    const jcs = new TextDecoder().decode(story.packageBytes)
    const blockingOf = async (bytes: Uint8Array | string) => {
      writePackage(dirs, id, bytes)
      return (await run(id, dirs)).blocking
    }

    expect
      .soft(await blockingOf(JSON.stringify(story.pkg, null, 2)), '(g1) pretty-printed')
      .toBe('package-not-jcs')
    expect
      .soft(await blockingOf(jcsBytes({ ...story.pkg, extra: 1 })), '(g2) JCS with an extra key')
      .toBe('package-strict-parse')
    expect
      .soft(
        await blockingOf(`{"__proto__":{},${jcs.slice(1)}`),
        '(g2) JCS with an own __proto__ key',
      )
      .toBe('package-strict-parse')
    expect
      .soft(
        await blockingOf(jcsBytes({ ...story.pkg, storyId: 'other-story' })),
        '(g3) another storyId',
      )
      .toBe('package-story-id')
    expect
      .soft(
        await blockingOf(jcsBytes({ ...story.pkg, collectionId: 'other-collection' })),
        '(g4) another collectionId',
      )
      .toBe('package-collection')
    const phase1 = edited(story.pkg, (pkg) => {
      pkg.assets = []
      for (const node of pkg.nodes) node.image = null
    })
    expect
      .soft(await blockingOf(jcsBytes(phase1)), '(g5) assets: [] is phase 1')
      .toBe('phase-1-package')
    unlinkSync(join(dirs.packagesDir, `${id}.json`))
    expect.soft((await run(id, dirs)).blocking, '(g6) missing').toBe('local-file-missing')
    expect
      .soft(await blockingOf('x'.repeat(1024 * 1024 + 1)), '(g6) 1 MiB + 1')
      .toBe('local-file-too-large')
  })

  it('T14-18 waiver file, local part (A6, D14-3)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const node = firstNonEnding(story.pkg)
    const dirs = writeStageInputs(root, [story])
    const base = await run(id, dirs)
    expect(
      base.waiver?.block.ruleSetRef === RULESET.ref && base.waiver.block.keys.length === 0,
      'precondition: the zero-record file gives a block for this rule set with keys []',
    ).toBe(true)
    const blockingOf = async (bytes: Uint8Array | string) => {
      writeWaiver(dirs, id, bytes)
      return (await run(id, dirs)).blocking
    }
    const file = (waivers: Rec[] = [], extra: Record<string, unknown> = {}) =>
      waiverBytesOf({ ...waiverFileOf(id, waivers), ...extra } as WaiverFile)

    unlinkSync(join(dirs.waiversDir, `${id}.json`))
    expect
      .soft((await run(id, dirs)).blocking, '(g1) migration without a file')
      .toBe('waiver-file-missing')
    writeWaiver(dirs, id, story.waiverBytes)
    writePackage(dirs, id, jcsBytes({ ...story.pkg, origin: 'agent_flow' }))
    expect
      .soft((await run(id, dirs)).blocking, '(g1) agent_flow with a file')
      .toBe('waiver-on-non-migration')
    writePackage(dirs, id, story.packageBytes)

    const crlf = encode(new TextDecoder().decode(story.waiverBytes).replaceAll('\n', '\r\n'))
    expect
      .soft(base.waiver?.block.waiverFileSha256, '(g2) the sha256 of the LF raw bytes')
      .toBe(await sha(story.waiverBytes))
    writeWaiver(dirs, id, crlf)
    expect
      .soft(
        (await run(id, dirs)).waiver?.block.waiverFileSha256,
        '(g2) the sha256 of the CRLF raw bytes',
      )
      .toBe(await sha(crlf))

    expect
      .soft(await blockingOf(new Uint8Array([0xff, 0xfe, 0x7b])), '(g3) invalid UTF-8')
      .toBe('waiver-file-invalid')
    expect.soft(await blockingOf('{not json'), '(g3) not JSON').toBe('waiver-file-invalid')
    expect
      .soft(await blockingOf(file([], { extra: 'x' })), '(g3) an extra key')
      .toBe('waiver-file-invalid')
    const proto = new TextDecoder()
      .decode(file([rec('E004', node, 'en')]))
      .replace('"checkId"', '"__proto__": {},\n      "checkId"')
    const schema = vi.spyOn(WaiverFile, 'safeParse')
    expect
      .soft(await blockingOf(proto), '(g3) an own __proto__ key at depth 2')
      .toBe('waiver-file-invalid')
    expect.soft(schema.mock.calls.length, '(g3) refused before the schema ran: __proto__').toBe(0)
    schema.mockRestore()

    expect
      .soft(await blockingOf(file([], { storyId: 'other-story' })), '(g4) another storyId')
      .toBe('waiver-story-id')
    expect
      .soft(
        await blockingOf(file([], { ruleSetRef: 'panchatantra@2.0.0' })),
        '(g4) another rule set',
      )
      .toBe('waiver-rule-set')

    const g5: [string, Rec[]][] = [
      ['a duplicate record', [rec('E004', node, 'en'), rec('E004', node, 'en')]],
      ['an A001 record', [rec('A001', node, null)]],
      ['an X000 record', [rec('X000', node, null)]],
      ['an S001 record', [rec('S001', node, null)]],
      [
        '257 records',
        Array.from({ length: 257 }, (_, i) =>
          rec('E004', node, 'en', i.toString(16).padStart(64, '0')),
        ),
      ],
    ]
    for (const [sample, waivers] of g5) {
      expect.soft(await blockingOf(file(waivers)), `(g5) ${sample}`).toBe('waiver-keys-invalid')
    }
  })

  it('T14-19 R24: a nodeId-null record passes only on the eight graph-bound checks with locale null (A7, L7, CRIT-19b)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const node = firstNonEnding(story.pkg)
    const dirs = writeStageInputs(root, [story])
    expect((await run(id, dirs)).blocking, 'precondition: the zero-record story passes').toBeNull()
    const withRecords = async (waivers: Rec[], extra: Record<string, unknown> = {}) => {
      writeWaiver(dirs, id, waiverBytesOf({ ...waiverFileOf(id, waivers), ...extra } as WaiverFile))
      return run(id, dirs)
    }

    const refused: [string, 'en' | null][] = [
      ['T003', 'en'],
      ['T003', null],
      ['G011', 'en'],
      ['E021', 'en'],
      ['A009', null],
      ['G010', 'en'],
      ['E001', 'en'],
    ]
    for (const [checkId, locale] of refused) {
      expect
        .soft(
          (await withRecords([rec(checkId, null, locale)])).blocking,
          `(g1) refused ${checkId} null/${locale}`,
        )
        .toBe('waiver-story-level-key')
    }
    for (const checkId of ['G001', 'G002', 'G007', 'G008', 'E001', 'E002', 'E003', 'E007']) {
      expect
        .soft(
          (await withRecords([rec(checkId, null, null)])).blocking,
          `(g2) accepted ${checkId} null/null`,
        )
        .toBeNull()
    }
    const textNull = await withRecords([rec('T001', node, null)])
    expect.soft(textNull.blocking, '(g3) node-level T001 locale null accepted').toBeNull()
    expect.soft(textNull.verdict?.counts.unusedKeys, '(g3) and counted unused').toBe(1)
    const nodeLevel = await withRecords([rec('E004', node, 'en')])
    expect.soft(nodeLevel.blocking, '(g3) node-level E004 with a locale accepted').toBeNull()

    const canary = await withRecords(
      [
        rec('T003', null, 'en', 'b'.repeat(64), {
          ruleId: 'S14CANARYruleId',
          measured: 'S14CANARYmeasured',
          limit: 'S14CANARYlimit',
        }),
      ],
      { basis: 'S14CANARYbasis', notes: ['S14CANARYnotes'], recordedBy: 'S14CANARYrecordedBy' },
    )
    expect
      .soft(canary.message, '(g4) the message names story, check and locale only')
      .toBe(`waiver-story-level-key story=${id} check=T003 locale=en`)
    expect.soft(visible(canary).includes('S14CANARY'), '(g4) no private-field canary').toBe(false)
    expect
      .soft(/[0-9a-f]{64}/.test(canary.message ?? ''), '(g4) no hash in the message')
      .toBe(false)
  })

  it('T14-20 validator in publish mode with the shared matcher; only unwaived errors block; A001 is never waived (A8, D14-2)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const node = firstNonEnding(story.pkg)
    const dirs = writeStageInputs(root, [story])
    const clean = await run(id, dirs)
    expect(clean.verdict?.counts.errors, 'precondition: the clean story has 0 errors').toBe(0)
    expect(
      clean.verdict?.findings.filter(
        (f) =>
          f.checkId === 'E004' && f.severity === 'error' && f.nodeId === node && f.locale === 'en',
      ).length,
      'precondition: no E004 error in node N, en',
    ).toBe(0)
    const runWith = async (pkg: StoryPackageV1, waivers: Rec[] = []) => {
      writePackage(dirs, id, jcsBytes(pkg))
      writeWaiver(dirs, id, waiverBytesOf(waiverFileOf(id, waivers)))
      return run(id, dirs)
    }

    const arabic = edited(story.pkg, (pkg) => {
      pkg.locales = ['en', 'hi', 'ar']
      pkg.text.ar = structuredClone(pkg.text.en!)
    })
    expect
      .soft((await runWith(arabic)).blocking, '(g1) ar (disabled) is G011 in publish mode')
      .toBe('validator-unwaived')

    const max = RULESET.limits.wordsPerNode.max
    const long = edited(story.pkg, (pkg) => {
      let text = enText(pkg, node)
      while (wordCount(text) <= max) text += ' lantern'
      setEnText(pkg, node, text)
    })
    const unkeyed = await runWith(long)
    expect.soft(unkeyed.blocking, '(g2) E004 over the maximum blocks').toBe('validator-unwaived')
    expect.soft(unkeyed.verdict?.counts.errors, '(g2) errors=1').toBe(1)
    expect
      .soft(
        unkeyed.verdict?.findings.some(
          (f) =>
            f.checkId === 'E004' &&
            f.severity === 'error' &&
            f.nodeId === node &&
            f.locale === 'en',
        ),
        '(g2) the finding is E004 node N en',
      )
      .toBe(true)

    const fingerprint = await findingFingerprint(long, { nodeId: node, locale: 'en' })
    const key = rec('E004', node, 'en', fingerprint)
    const keyed = await runWith(long, [key])
    expect.soft(keyed.blocking, '(g3) the keyed error passes').toBeNull()
    expect.soft(keyed.verdict?.counts.waived, '(g3) waived=1').toBe(1)

    const changed = edited(long, (pkg) => setEnText(pkg, node, `${enText(pkg, node)} lantern`))
    const lapsed = await runWith(changed, [key])
    expect.soft(lapsed.blocking, '(g4) text changed after keying blocks').toBe('validator-unwaived')
    expect.soft(lapsed.verdict?.counts.lapsed, '(g4) lapsed=1').toBe(1)
    expect.soft(lapsed.verdict?.counts.waived, '(g4) waived=0').toBe(0)

    const unused = await runWith(story.pkg, [rec('E004', node, 'en', 'f'.repeat(64))])
    expect.soft(unused.blocking, '(g5) a key that matches nothing does not block').toBeNull()
    expect.soft(unused.verdict?.counts.unusedKeys, '(g5) unused-keys=1').toBe(1)

    const cyrillic = edited(story.pkg, (pkg) => setEnText(pkg, node, `${enText(pkg, node)} Ж`))
    const t006 = await runWith(cyrillic)
    expect.soft(t006.blocking, '(g6) a T006 warning does not block').toBeNull()
    expect
      .soft(
        t006.verdict?.findings.some((f) => f.checkId === 'T006' && f.severity === 'warn'),
        '(g6) T006 raised',
      )
      .toBe(true)

    const noImage = edited(story.pkg, (pkg) => {
      const target = pkg.nodes.find((n) => n.id === node)!
      target.image = 'e'.repeat(64)
    })
    const a001 = await runWith(noImage)
    expect.soft(a001.blocking, '(g7) A001 blocks').toBe('validator-unwaived')
    expect
      .soft(
        a001.verdict?.findings.some((f) => f.checkId === 'A001'),
        '(g7) with an A001 finding',
      )
      .toBe(true)
    const a001Key = {
      checkId: 'A001',
      nodeId: node,
      locale: null,
      nodeTextSha256: await findingFingerprint(noImage, { nodeId: node, locale: null }),
    }
    const verdict = await validatorVerdict(
      noImage,
      { ruleSetRef: RULESET.ref, waiverFileSha256: 'c'.repeat(64), keys: [a001Key] },
      null,
    )
    expect.soft(verdict.blocking, '(g7) an exact A001 key leaves it blocking').toBe(true)
    expect
      .soft(
        verdict.findings.some((f) => f.checkId === 'A001' && f.waived !== true),
        '(g7) A001 stays unwaived',
      )
      .toBe(true)
  })

  it('T14-21 private word lists: absent, loaded, or private-lists-invalid (A8, TP-1)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const node = firstNonEnding(story.pkg)
    expect(existsSync(join(root, '.rules-private')), 'precondition: no .rules-private').toBe(false)
    const absent = loadPrivateLists(root)
    expect
      .soft(absent, '(g1) absent: not loaded')
      .toEqual({ ok: true, data: null, state: 'not loaded' })
    const withIdiom = edited(story.pkg, (pkg) =>
      setEnText(pkg, node, `${enText(pkg, node)} zqxidiom`),
    )
    const dirs = writeStageInputs(root, [await withPackage(story, withIdiom)])
    const skipped = (await run(id, dirs)).verdict?.skipped ?? []
    expect
      .soft(
        ['E016', 'E017', 'E018'].every((c) => skipped.includes(c)),
        '(g1) E016-E018 skipped',
      )
      .toBe(true)

    const folder = join(root, '.rules-private')
    const path = join(folder, `${RULESET.ref}.private.json`)
    mkdirSync(folder)
    const valid = {
      ref: RULESET.ref,
      idioms: ['zqxidiom'],
      anachronismKeywords: [],
      sanskritNeverCall: {},
    }
    writeFileSync(path, JSON.stringify(valid))
    const loaded = loadPrivateLists(root)
    expect.soft(loaded.ok && loaded.state, '(g2) loaded').toBe('loaded')
    const withLists = await run(id, dirs, loaded.ok ? loaded.data : null)
    expect
      .soft(
        withLists.verdict?.findings.filter((f) => f.checkId === 'E016').length,
        '(g2) one E016 warning',
      )
      .toBe(1)
    expect.soft(withLists.blocking, '(g2) E016 does not block').toBeNull()

    const invalid: [string, () => void][] = [
      ['an extra key', () => writeFileSync(path, JSON.stringify({ ...valid, extra: [] }))],
      [
        'another ref',
        () => writeFileSync(path, JSON.stringify({ ...valid, ref: 'panchatantra@2.0.0' })),
      ],
      ['not JSON', () => writeFileSync(path, '{not json')],
      [
        'a directory',
        () => {
          rmSync(path)
          mkdirSync(path)
        },
      ],
    ]
    for (const [sample, plant] of invalid) {
      plant()
      expect
        .soft(loadPrivateLists(root), `(g3) ${sample}`)
        .toEqual({ ok: false, code: 'private-lists-invalid' })
    }
  })

  it('T14-22 the build checkPackage runs once per story on the exact bytes and entry; a refusal is package-gate and its reason is never printed (A8, §4.2 step 6)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const dirs = writeStageInputs(root, [story])
    const clean = await run(id, dirs)
    expect(clean.blocking, 'precondition: the clean story passes').toBeNull()
    const direct = await packages.checkPackage(
      story.packageBytes,
      entryOf(story.pkg, story.packageSha256, {
        ruleSetRef: RULESET.ref,
        waiverFileSha256: story.waiverSha256,
        keys: [],
      }),
      RULESET,
      { requireJcs: true },
    )
    expect(direct.ok, 'precondition: the spy calls through to the real checkPackage').toBe(true)

    checkPackageSpy.mockClear()
    await run(id, dirs)
    const calls = checkPackageSpy.mock.calls
    expect.soft(calls.length, '(g1) one call per story').toBe(1)
    const [bytes, entry, ruleSet, options] = calls[0] ?? []
    expect
      .soft(bytes ? await sha(bytes) : null, '(g1) the bytes of the file')
      .toBe(story.packageSha256)
    expect.soft(entry, '(g1) the entry stage writes').toEqual(
      entryOf(story.pkg, story.packageSha256, {
        ruleSetRef: RULESET.ref,
        waiverFileSha256: story.waiverSha256,
        keys: [],
      }),
    )
    expect
      .soft(ruleSet === RULESET && options, '(g1) requireJcs true')
      .toEqual({ requireJcs: true })

    checkPackageSpy.mockResolvedValueOnce({ ok: false, reason: 'S14CANARYREASON' })
    const refused = await run(id, dirs)
    expect.soft(refused.blocking, '(g2) a refusal is package-gate').toBe('package-gate')
    expect
      .soft(visible(refused).includes('S14CANARYREASON'), '(g3) the reason is in no result')
      .toBe(false)
  })

  it('T14-23 S5: after steps 1-4, the step-5 verdict equals checkPackage on the same bytes and entry (CRIT-8)', async () => {
    const story = (await testStories())[0]!
    const id = story.storyId
    const node = firstNonEnding(story.pkg)
    const dirs = writeStageInputs(root, [story])
    const long = edited(story.pkg, (pkg) => {
      let text = enText(pkg, node)
      while (wordCount(text) <= RULESET.limits.wordsPerNode.max) text += ' lantern'
      setEnText(pkg, node, text)
    })
    const key = rec(
      'E004',
      node,
      'en',
      await findingFingerprint(long, { nodeId: node, locale: 'en' }),
    )
    const changed = edited(long, (pkg) => setEnText(pkg, node, `${enText(pkg, node)} lantern`))
    const cases: [string, StoryPackageV1, Rec[]][] = [
      ['clean', story.pkg, []],
      ['unkeyed error', long, []],
      ['keyed', long, [key]],
      ['lapsed', changed, [key]],
      ['unused key', story.pkg, [rec('E004', node, 'en', 'f'.repeat(64))]],
      [
        'G011',
        edited(story.pkg, (pkg) => {
          pkg.locales = ['en', 'hi', 'ar']
          pkg.text.ar = structuredClone(pkg.text.en!)
        }),
        [],
      ],
      ['T006', edited(story.pkg, (pkg) => setEnText(pkg, node, `${enText(pkg, node)} Ж`)), []],
    ]
    for (const [sample, pkg, waivers] of cases) {
      const bytes = jcsBytes(pkg)
      writePackage(dirs, id, bytes)
      writeWaiver(dirs, id, waiverBytesOf(waiverFileOf(id, waivers)))
      const local = await run(id, dirs)
      expect(
        [null, 'validator-unwaived', 'package-gate'].includes(local.blocking),
        `precondition: ${sample} passes steps 1-4`,
      ).toBe(true)
      const block = local.waiver?.block ?? null
      const step5 = await validatorVerdict(pkg, block, null)
      const gate = await packages.checkPackage(
        bytes,
        entryOf(pkg, await sha(bytes), block),
        RULESET,
        {
          requireJcs: true,
        },
      )
      expect.soft(step5.blocking, `(g1) step 5 equals checkPackage: ${sample}`).toBe(!gate.ok)
    }
  })

  it('T14-24 media in the story checks: planMediaHeads once per story, then the variant codes; the first failure blocks its story and later stories still run (A9, CRIT-16)', async () => {
    const [one, two] = await testStories()
    const s1 = one!
    const s2 = two!
    const dirs = writeStageInputs(root, [s1, s2])
    const both = () => checkStories([s1.storyId, s2.storyId], { ...dirs, privateData: null })
    expect(
      (await both()).map((r) => r.blocking),
      'precondition: two stories, both pass',
    ).toEqual([null, null])

    const foreign = edited(s1.pkg, (pkg) => {
      const image = pkg.assets.find((a) => a.kind === 'image')!
      const hex = image.variants[0]!.path.split('/').pop()!.slice(0, 64)
      image.variants[0]!.path = `media/${s2.storyId}/${hex}-s14canary.webp`
    })
    writePackage(dirs, s1.storyId, jcsBytes(foreign))
    const plan = await both()
    expect
      .soft(
        plan.map((r) => r.blocking),
        '(g1) media-plan for story 1 only',
      )
      .toEqual(['media-plan', null])
    expect
      .soft(
        plan.some((r) => visible(r).includes('s14canary')),
        '(g2) the plan reason is in no result',
      )
      .toBe(false)

    const reset = () => writeStageInputs(root, [s1, s2])
    const firstMedia = s1.media[0]!
    const mediaPath = join(dirs.mediaDir, ...firstMedia.path.split('/'))
    reset()
    unlinkSync(mediaPath)
    expect.soft((await both())[0]?.blocking, '(g3) a missing media file').toBe('local-file-missing')
    reset()
    const bigger = edited(s1.pkg, (pkg) => {
      const variant = pkg.assets.find((a) => a.kind === 'image')!.variants[0]!
      variant.bytes += 1
    })
    writePackage(dirs, s1.storyId, jcsBytes(bigger))
    expect.soft((await both())[0]?.blocking, '(g3) media-size').toBe('media-size')
    reset()
    const swapped = firstMedia.bytes.slice()
    swapped[swapped.length - 1] = (swapped[swapped.length - 1]! + 1) & 0xff
    writeFileSync(mediaPath, swapped)
    expect.soft((await both())[0]?.blocking, '(g3) media-hash').toBe('media-hash')
    reset()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const pngHex = await sha(png)
    const pngPath = `media/${s1.storyId}/${pngHex}-w768.webp`
    const typed = edited(s1.pkg, (pkg) => {
      const variant = pkg.assets.find((a) => a.kind === 'image')!.variants[0]!
      variant.path = pngPath
      variant.bytes = png.length
    })
    writePackage(dirs, s1.storyId, jcsBytes(typed))
    writeFileSync(join(dirs.mediaDir, ...pngPath.split('/')), png)
    expect.soft((await both())[0]?.blocking, '(g3) media-type').toBe('media-type')

    reset()
    writePackage(dirs, s1.storyId, JSON.stringify(s1.pkg, null, 2))
    const later = await both()
    expect
      .soft(
        later.map((r) => [r.storyId, r.blocking]),
        '(g4) story 1 blocked at step 2, story 2 still checked and reported',
      )
      .toEqual([
        [s1.storyId, 'package-not-jcs'],
        [s2.storyId, null],
      ])
  })
})
