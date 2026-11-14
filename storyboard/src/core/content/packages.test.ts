import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { sha256Hex } from '../hashing'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import { checkPackage, checkUniqueStoryIds, describeFinding, type SnapshotEntry } from './packages'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Json => structuredClone(fixture) as Json
const encode = (text: string) => new TextEncoder().encode(text)
const bytesOf = (value: unknown) => encode(JSON.stringify(value, null, 2))

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

const check = async (bytes: Uint8Array<ArrayBuffer>, over: Partial<SnapshotEntry> = {}) =>
  checkPackage(bytes, await entryFor(bytes, over), PANCHATANTRA_RULESET)

describe('checkPackage', () => {
  it('accepts a clean package and keeps its exact bytes', async () => {
    const bytes = bytesOf(base())
    const r = await check(bytes)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.bytes).toBe(bytes)
    expect(r.value.pkg.storyId).toBe('two-paths')
    expect(r.value.report.ok).toBe(true)
    expect(r.value.report.mode).toBe('publish')
  })

  it('reports E016-E018 as skipped, because the private word lists are local only', async () => {
    const r = await check(bytesOf(base()))
    expect(r.ok && r.value.report.skipped).toEqual([
      { checkId: 'E016', reason: 'private word lists not loaded' },
      { checkId: 'E017', reason: 'private word lists not loaded' },
      { checkId: 'E018', reason: 'private word lists not loaded' },
    ])
  })

  it('fails on a sha256 mismatch before parsing', async () => {
    const bytes = encode('not json at all')
    const entry = await entryFor(bytesOf(base()))
    expect(await checkPackage(bytes, entry, PANCHATANTRA_RULESET)).toEqual({
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

  it('fails on an unwaived validator error and names the first one', async () => {
    const pkg = base()
    pkg.text.en.nodes.start.question = 'Which way? Left or right?'
    expect(await check(bytesOf(pkg))).toEqual({
      ok: false,
      reason:
        'package two-paths failed the validator with 1 error(s); first: E005 node=start locale=en: 2 question marks (exactly 1 expected)',
    })
  })

  it('runs the validator in publish mode, so a disabled locale fails (G011)', async () => {
    const pkg = base()
    pkg.locales = ['en', 'hi', 'ar']
    pkg.text.ar = structuredClone(pkg.text.en)
    const r = await check(bytesOf(pkg))
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('G011') })
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
