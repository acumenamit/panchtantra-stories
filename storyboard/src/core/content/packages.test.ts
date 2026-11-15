// Package gate (spec §3.2). P1-2b (design p1-step8-design.md §4.1 row 10, §5.3, §5.4, §10.1):
// canonical JCS for Storage packages, collectionId, the snapshot entry's public waiver keys, and
// the unwaived-finding details printed before the failure line.
import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { jcsBytes, sha256Hex, toJcs } from '../hashing'
import { compareWaiverKeys, type WaiverKey, type WaiverKeys } from '../package/catalogue'
import { StoryPackageV1 } from '../package/v1'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import { validatePackage } from '../validator/validate'
import { deriveWaiverKeys, draftWaivers, findingFingerprint } from '../validator/waivers'
import {
  checkPackage,
  checkUniqueStoryIds,
  describeFinding,
  MAX_UNWAIVED_LINES,
  packageLogLines,
  type CheckedPackage,
  type SnapshotEntry,
} from './packages'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Json => structuredClone(fixture) as Json
const encode = (text: string) => new TextEncoder().encode(text)
const bytesOf = (value: unknown) => encode(JSON.stringify(value, null, 2))
const FILE_SHA = 'f'.repeat(64)
const LAPSED = ' (lapsed: a key for this check, node and locale binds other text)'
const SKIPPED_LINE =
  'content: validator skipped E016,E017,E018 for story=two-paths (private word lists not loaded)'

/** An entry that names these bytes by their sha256, as a snapshot would. */
async function entryFor(
  bytes: Uint8Array<ArrayBuffer>,
  over: Partial<SnapshotEntry> = {},
): Promise<SnapshotEntry> {
  return {
    storyId: 'two-paths',
    collectionId: 'panchatantra',
    version: 1,
    packagePath: 'packages/two-paths.json',
    packageSha256: await sha256Hex(bytes),
    ...over,
  }
}

/** `requireJcs` defaults to false here, the fixtures behaviour; checkPackage itself has no default. */
const check = async (
  bytes: Uint8Array<ArrayBuffer>,
  over: Partial<SnapshotEntry> = {},
  requireJcs = false,
) => checkPackage(bytes, await entryFor(bytes, over), PANCHATANTRA_RULESET, { requireJcs })

/** The passing value, or a test failure naming the reason. */
function passed(r: Awaited<ReturnType<typeof checkPackage>>): CheckedPackage {
  if (!r.ok) throw new Error(`expected a pass, got: ${r.reason}`)
  return r.value
}

/** Three error findings, as in waivers.test.ts: E010 (locale-free), E014 (en text), E003 (story). */
function broken(): Json {
  const p = base()
  p.nodes.find((n: Json) => n.id === 'start').choices[1].next = 'wise_path'
  p.text.en.nodes.ending_wise.text = 'Home.'
  p.nodes = p.nodes.filter((n: Json) => !['quick_path', 'ending_quick'].includes(n.id))
  for (const l of ['en', 'hi']) {
    delete p.text[l].nodes.quick_path
    delete p.text[l].nodes.ending_quick
  }
  return p
}

/** The public waiver block the owner's approved draft for this package would give (D9). */
async function keysFor(p: Json): Promise<WaiverKeys> {
  const pkg = StoryPackageV1.parse(p)
  const report = validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
  const file = await draftWaivers(report, pkg, { basis: 'test', recordedOn: '2026-11-15' })
  return deriveWaiverKeys(file, FILE_SHA)
}

const sorted = (keys: WaiverKey[]) => [...keys].sort(compareWaiverKeys)

describe('checkPackage', () => {
  it('accepts a clean package and keeps its exact bytes', async () => {
    const bytes = bytesOf(base())
    const value = passed(await check(bytes))
    expect(value.bytes).toBe(bytes)
    expect(value.pkg.storyId).toBe('two-paths')
    expect(value.report.ok).toBe(true)
    expect(value.report.mode).toBe('publish')
    expect(value.waived).toEqual([])
    expect(value.unusedKeys).toEqual([])
    expect(value.lapsed).toEqual([])
    expect(value.counts.errors).toBe(0)
    expect(value.counts.waived).toBe(0)
  })

  it('reports E016-E018 as skipped, because the private word lists are local only', async () => {
    const r = await check(bytesOf(base()))
    expect(r.ok && r.value.report.skipped).toEqual([
      { checkId: 'E016', reason: 'private word lists not loaded' },
      { checkId: 'E017', reason: 'private word lists not loaded' },
      { checkId: 'E018', reason: 'private word lists not loaded' },
    ])
  })

  it('counts warnings and info from the publish-mode report', async () => {
    const pkg = StoryPackageV1.parse(base())
    const fresh = validatePackage(pkg, { ruleSet: PANCHATANTRA_RULESET, mode: 'publish' })
    const value = passed(await check(bytesOf(base())))
    expect(value.counts).toEqual({
      errors: 0,
      waived: 0,
      warnings: fresh.findings.filter((f) => f.severity === 'warn').length,
      info: fresh.findings.filter((f) => f.severity === 'info').length,
    })
    // Phase-1 style package: no media, so A005/A006 are warnings outside --feature.
    expect(value.counts.warnings).toBeGreaterThan(0)
  })

  it('fails on a sha256 mismatch before parsing', async () => {
    const bytes = encode('not json at all')
    const entry = await entryFor(bytesOf(base()))
    expect(await checkPackage(bytes, entry, PANCHATANTRA_RULESET, { requireJcs: false })).toEqual({
      ok: false,
      reason: 'package two-paths sha256 mismatch',
    })
  })

  it('fails on bytes that are not JSON, even when the hash matches', async () => {
    expect(await check(encode('{"storyId":'))).toEqual({
      ok: false,
      reason: 'package two-paths is not valid UTF-8 JSON',
    })
  })

  it('fails on an own "__proto__" key', async () => {
    const text = JSON.stringify(base()).replace('{', '{"__proto__":{},')
    expect(await check(encode(text))).toEqual({
      ok: false,
      reason: 'package two-paths contains a "__proto__" key',
    })
  })

  it('fails the strict parse on an unknown key', async () => {
    expect(await check(bytesOf({ ...base(), extra: 1 }))).toEqual({
      ok: false,
      reason: expect.stringMatching(/^package two-paths failed strict parse: /),
    })
  })

  it('fails when the package storyId differs from the snapshot entry', async () => {
    const pkg = base()
    pkg.storyId = 'other-story'
    expect(await check(bytesOf(pkg))).toEqual({
      ok: false,
      reason: 'package two-paths has storyId other-story, but the snapshot names two-paths',
    })
  })

  it('fails when the package version differs from the snapshot entry', async () => {
    expect(await check(bytesOf(base()), { version: 2 })).toEqual({
      ok: false,
      reason: 'package two-paths has version 1, but the snapshot names 2',
    })
  })

  it('fails on an unwaived validator error, names the first one and lists it as a detail', async () => {
    const pkg = base()
    pkg.text.en.nodes.start.question = 'Which way? Left or right?'
    expect(await check(bytesOf(pkg))).toEqual({
      ok: false,
      reason:
        'package two-paths failed the validator with 1 unwaived error(s); first: E005 node=start locale=en: 2 question marks (exactly 1 expected)',
      details: [
        'content: unwaived story=two-paths check=E005 node=start locale=en: 2 question marks (exactly 1 expected)',
      ],
    })
  })

  it('runs the validator in publish mode, so a disabled locale fails (G011)', async () => {
    const pkg = base()
    pkg.locales = ['en', 'hi', 'ar']
    pkg.text.ar = structuredClone(pkg.text.en)
    const r = await check(bytesOf(pkg))
    expect(r).toEqual({
      ok: false,
      reason: expect.stringContaining('G011'),
      details: expect.arrayContaining([expect.stringContaining('check=G011')]),
    })
  })

  it('gives no details for failures other than the validator', async () => {
    const r = await check(bytesOf(base()), { version: 2 })
    expect(r).not.toHaveProperty('details')
  })

  it('counts T006 (letters outside the rendered scripts) as a warning, never an error', async () => {
    const pkg = base()
    pkg.text.hi.nodes.start.text = `${pkg.text.hi.nodes.start.text} 漢字`
    const value = passed(await check(bytesOf(pkg)))
    const t006 = value.report.findings.filter((f) => f.checkId === 'T006')
    expect(t006).toEqual([
      expect.objectContaining({ severity: 'warn', nodeId: 'start', locale: 'hi' }),
    ])
    expect(value.counts.errors).toBe(0)
  })
})

describe('checkPackage: Storage packages must be canonical JCS (P1-2b)', () => {
  it('accepts JCS bytes when JCS is required', async () => {
    const bytes = jcsBytes(base())
    expect(passed(await check(bytes, {}, true)).bytes).toBe(bytes)
  })

  it.each([
    ['pretty-printed', JSON.stringify(base(), null, 2)],
    ['keys in source order', JSON.stringify(base())],
    ['a trailing newline', `${toJcs(base())}\n`],
  ])('refuses %s bytes in Storage mode and accepts them in fixtures mode', async (_why, text) => {
    const bytes = encode(text)
    expect(await check(bytes, {}, true)).toEqual({
      ok: false,
      reason: 'package two-paths is not canonical JCS',
    })
    expect((await check(bytes, {}, false)).ok).toBe(true)
    expect((await check(bytes)).ok).toBe(true) // no options: fixtures behaviour, as before P1-2b
  })

  it('checks the sha256 first, then the JSON, then JCS, then the strict parse', async () => {
    const entry = await entryFor(jcsBytes(base()))
    const pretty = bytesOf(base())
    expect(await checkPackage(pretty, entry, PANCHATANTRA_RULESET, { requireJcs: true })).toEqual({
      ok: false,
      reason: 'package two-paths sha256 mismatch',
    })
    expect(await check(encode('{"storyId":'), {}, true)).toEqual({
      ok: false,
      reason: 'package two-paths is not valid UTF-8 JSON',
    })
    expect(await check(bytesOf({ ...base(), extra: 1 }), {}, true)).toEqual({
      ok: false,
      reason: 'package two-paths is not canonical JCS',
    })
    expect(await check(jcsBytes({ ...base(), extra: 1 }), {}, true)).toEqual({
      ok: false,
      reason: expect.stringMatching(/^package two-paths failed strict parse: /),
    })
  })
})

describe('checkPackage: collectionId (P1-2b)', () => {
  it('fails when the package collectionId differs from the snapshot entry', async () => {
    expect(await check(bytesOf(base()), { collectionId: 'fables' })).toEqual({
      ok: false,
      reason: 'package two-paths has collectionId panchatantra, but the snapshot names fables',
    })
  })

  it('fails when package and entry agree on a collection this build has no rule set for', async () => {
    const pkg = base()
    pkg.collectionId = 'fables'
    expect(await check(bytesOf(pkg), { collectionId: 'fables' })).toEqual({
      ok: false,
      reason:
        'package two-paths is in collection fables; this build has only the panchatantra rule set',
    })
  })

  it('prints collection names only through the log sanitiser', async () => {
    const pkg = base()
    pkg.collectionId = `a b\nc${'x'.repeat(100)}`
    const r = await check(bytesOf(pkg), { collectionId: pkg.collectionId })
    expect(r).toEqual({
      ok: false,
      reason: `package two-paths is in collection abc${'x'.repeat(61)}; this build has only the panchatantra rule set`,
    })
    const mismatch = await check(bytesOf(base()), { collectionId: 'x\ny z' })
    expect(mismatch).toEqual({
      ok: false,
      reason: 'package two-paths has collectionId panchatantra, but the snapshot names xyz',
    })
  })
})

describe('checkPackage: waiver keys (D9, design §5.3, §5.4)', () => {
  it('waives the errors the keys name, logs each, and passes', async () => {
    const p = broken()
    const block = await keysFor(p)
    expect(block.keys).toHaveLength(3)
    const value = passed(await check(bytesOf(p), { waivers: block }))
    expect(value.report.ok).toBe(true)
    const errors = value.report.findings.filter((f) => f.severity === 'error')
    expect(errors.map((f) => f.checkId).sort()).toEqual(['E003', 'E010', 'E014'])
    expect(errors.every((f) => f.waived === true)).toBe(true)
    expect(value.waived).toEqual(errors)
    expect(value.counts).toMatchObject({ errors: 0, waived: 3 })
    expect(value.unusedKeys).toEqual([])
    expect(value.lapsed).toEqual([])
  })

  it('fails closed without a block: every error is unwaived and listed', async () => {
    const p = broken()
    const r = await check(bytesOf(p))
    if (r.ok) throw new Error('expected a failure')
    const pkg = StoryPackageV1.parse(p)
    const errors = validatePackage(pkg, {
      ruleSet: PANCHATANTRA_RULESET,
      mode: 'publish',
    }).findings.filter((f) => f.severity === 'error')
    expect(errors).toHaveLength(3)
    expect(r.reason).toBe(
      `package two-paths failed the validator with 3 unwaived error(s); first: ${describeFinding(errors[0]!)}`,
    )
    expect(r.details).toEqual(
      errors.map(
        (f) =>
          `content: unwaived story=two-paths check=${f.checkId} node=${f.nodeId ?? '-'} locale=${f.locale ?? '-'}: ${f.message}`,
      ),
    )
  })

  it('treats an empty block like no block', async () => {
    const p = broken()
    const block = { ...(await keysFor(p)), keys: [] }
    const r = await check(bytesOf(p), { waivers: block })
    expect(r).toEqual({
      ok: false,
      reason: expect.stringMatching(/ failed the validator with 3 unwaived error\(s\); first: /),
      details: expect.any(Array),
    })
  })

  it('logs a key that matches no finding as unused, and still passes', async () => {
    const p = broken()
    const block = await keysFor(p)
    const extra: WaiverKey = {
      checkId: 'E005',
      nodeId: 'start',
      locale: 'en',
      nodeTextSha256: 'c'.repeat(64),
    }
    const value = passed(
      await check(bytesOf(p), { waivers: { ...block, keys: sorted([...block.keys, extra]) } }),
    )
    expect(value.unusedKeys).toEqual([extra])
    expect(value.counts.waived).toBe(3)
  })

  it('marks a finding whose key binds other text as lapsed, and fails', async () => {
    const p = broken()
    const block = await keysFor(p)
    p.text.en.nodes.ending_wise.text = 'Home again.' // the waived E014 node changes
    const pkg = StoryPackageV1.parse(p)
    const e014 = validatePackage(pkg, {
      ruleSet: PANCHATANTRA_RULESET,
      mode: 'publish',
    }).findings.find((f) => f.checkId === 'E014')!
    expect(await check(bytesOf(p), { waivers: block })).toEqual({
      ok: false,
      reason: `package two-paths failed the validator with 1 unwaived error(s); first: E014 node=ending_wise locale=en: ${e014.message}`,
      details: [
        `content: unwaived story=two-paths check=E014 node=ending_wise locale=en: ${e014.message}${LAPSED}`,
      ],
    })
  })

  it.each(['agent_flow', 'writer_flow'])(
    'fails on keys carried by an origin %s package, even an empty block',
    async (origin) => {
      const pkg = base()
      pkg.origin = origin
      const block = await keysFor(base())
      const reason = `package two-paths carries waiver keys but its origin is ${origin}; waivers apply only to origin migration (spec §5.3)`
      expect(await check(bytesOf(pkg), { waivers: block })).toEqual({ ok: false, reason })
      expect(await check(bytesOf(pkg), { waivers: { ...block, keys: [] } })).toEqual({
        ok: false,
        reason,
      })
      expect((await check(bytesOf(pkg))).ok).toBe(true) // the origin alone is fine
    },
  )

  it('fails on keys recorded under another rule set, even when nothing needs waiving', async () => {
    const block = { ...(await keysFor(broken())), ruleSetRef: 'panchatantra@3.1.0' }
    const reason =
      'waiver keys for two-paths were recorded for panchatantra@3.1.0; this build validates with panchatantra@3.0.0'
    expect(await check(bytesOf(broken()), { waivers: block })).toEqual({ ok: false, reason })
    expect(await check(bytesOf(base()), { waivers: block })).toEqual({ ok: false, reason })
  })

  it('checks the origin before the rule set', async () => {
    const pkg = base()
    pkg.origin = 'agent_flow'
    const block = { ...(await keysFor(base())), ruleSetRef: 'other@1.0.0' }
    expect(await check(bytesOf(pkg), { waivers: block })).toEqual({
      ok: false,
      reason: expect.stringContaining('carries waiver keys but its origin is agent_flow'),
    })
  })

  it('never waives A001, even with a key that matches it, and never calls it lapsed', async () => {
    const p = base()
    p.nodes[0].image = 'e'.repeat(64) // a picture with no image asset
    const pkg = StoryPackageV1.parse(p)
    const forged: WaiverKey = {
      checkId: 'A001',
      nodeId: 'start',
      locale: null,
      nodeTextSha256: await findingFingerprint(pkg, { nodeId: 'start', locale: null }),
    }
    const block: WaiverKeys = {
      ruleSetRef: 'panchatantra@3.0.0',
      waiverFileSha256: FILE_SHA,
      keys: [forged],
    }
    expect(await check(bytesOf(p), { waivers: block })).toEqual({
      ok: false,
      reason:
        'package two-paths failed the validator with 1 unwaived error(s); first: A001 node=start: Picture eeeeeeeeeeee names no image asset',
      details: [
        'content: unwaived story=two-paths check=A001 node=start locale=-: Picture eeeeeeeeeeee names no image asset',
      ],
    })
  })
})

describe('checkPackage: unwaived details are capped at 20 lines', () => {
  /** Text entries for `count` nodes that do not exist: one G010 error each, nothing else. */
  function withUnknownNodes(count: number): Json {
    const p = base()
    for (let i = 1; i <= count; i++) p.text.en.nodes[`extra_${i}`] = { text: 'Extra.' }
    return p
  }

  const errorCount = (p: Json) =>
    validatePackage(StoryPackageV1.parse(p), {
      ruleSet: PANCHATANTRA_RULESET,
      mode: 'publish',
    }).findings.filter((f) => f.severity === 'error').length

  it('lists exactly 20 when there are 20', async () => {
    const p = withUnknownNodes(20)
    expect(errorCount(p)).toBe(20)
    const r = await check(bytesOf(p))
    if (r.ok) throw new Error('expected a failure')
    expect(r.details).toHaveLength(MAX_UNWAIVED_LINES)
    expect(
      r.details?.every((line) =>
        line.startsWith('content: unwaived story=two-paths check=G010 node=- locale=en: '),
      ),
    ).toBe(true)
    expect(r.reason).toBe(
      'package two-paths failed the validator with 20 unwaived error(s); first: G010 locale=en: Text for unknown node "extra_1"',
    )
  })

  it('lists the first 20 in report order, then counts the rest', async () => {
    const p = withUnknownNodes(27)
    expect(errorCount(p)).toBe(27)
    const r = await check(bytesOf(p))
    if (r.ok) throw new Error('expected a failure')
    expect(r.reason).toMatch(/ failed the validator with 27 unwaived error\(s\); first: G010 /)
    expect(r.details).toHaveLength(21)
    expect(r.details?.[0]).toBe(
      'content: unwaived story=two-paths check=G010 node=- locale=en: Text for unknown node "extra_1"',
    )
    expect(r.details?.[19]).toBe(
      'content: unwaived story=two-paths check=G010 node=- locale=en: Text for unknown node "extra_20"',
    )
    expect(r.details?.[20]).toBe('content: unwaived … and 7 more')
  })
})

describe('packageLogLines', () => {
  it('gives the package line, then each waived finding, then each unused key, then skipped checks', async () => {
    const p = broken()
    const block = await keysFor(p)
    const extra: WaiverKey = {
      checkId: 'E005',
      nodeId: 'start',
      locale: 'en',
      nodeTextSha256: 'c'.repeat(64),
    }
    const bytes = bytesOf(p)
    const value = passed(
      await check(bytes, { waivers: { ...block, keys: sorted([...block.keys, extra]) } }),
    )
    const { warnings, info } = value.counts
    const sha12 = (await sha256Hex(bytes)).slice(0, 12)
    expect(packageLogLines(value)).toEqual([
      `content: package story=two-paths version=1 sha=${sha12} errors=0 waived=3 warnings=${warnings} info=${info}`,
      ...value.waived.map(
        (f) =>
          `content: waived story=two-paths check=${f.checkId} node=${f.nodeId ?? '-'} locale=${f.locale ?? '-'}`,
      ),
      'content: waiver key unused story=two-paths check=E005 node=start locale=en (no matching finding)',
      SKIPPED_LINE,
    ])
    expect(packageLogLines(value).filter((l) => l.startsWith('content: waived '))).toHaveLength(3)
    expect(packageLogLines(value)).toContain(
      'content: waived story=two-paths check=E003 node=- locale=-',
    )
    expect(packageLogLines(value)).toContain(
      'content: waived story=two-paths check=E014 node=ending_wise locale=en',
    )
  })

  it('gives only the package line and the skipped line for a clean package', async () => {
    const bytes = bytesOf(base())
    const value = passed(await check(bytes))
    const sha12 = (await sha256Hex(bytes)).slice(0, 12)
    expect(packageLogLines(value)).toEqual([
      `content: package story=two-paths version=1 sha=${sha12} errors=0 waived=0 warnings=${value.counts.warnings} info=${value.counts.info}`,
      SKIPPED_LINE,
    ])
  })
})

describe('checkUniqueStoryIds', () => {
  const entry = (storyId: string): SnapshotEntry => ({
    storyId,
    collectionId: 'panchatantra',
    version: 1,
    packagePath: `packages/${storyId}.json`,
    packageSha256: 'a'.repeat(64),
  })

  it('accepts distinct storyIds and an empty list', () => {
    expect(checkUniqueStoryIds([entry('a-1'), entry('b-2')])).toEqual({ ok: true, value: null })
    expect(checkUniqueStoryIds([])).toEqual({ ok: true, value: null })
  })

  it('names a storyId listed twice', () => {
    expect(checkUniqueStoryIds([entry('a-1'), entry('b-2'), entry('a-1')])).toEqual({
      ok: false,
      reason: 'snapshot lists story a-1 more than once',
    })
  })
})

describe('describeFinding', () => {
  it('names the check, node and locale when present', () => {
    const f = { checkId: 'G010', ruleId: null, severity: 'error' as const, message: 'm' }
    expect(describeFinding({ ...f, nodeId: 'start', locale: 'hi' })).toBe(
      'G010 node=start locale=hi: m',
    )
    expect(describeFinding({ ...f, nodeId: null, locale: null })).toBe('G010: m')
  })
})
