import { describe, expect, it } from 'vitest'
import { BuildInfo, type ContentFetch } from './build-info'

const SHA = 'c'.repeat(64)

const fetchRow = (over: Partial<ContentFetch> = {}): ContentFetch => ({
  path: 'catalogue/production.json',
  status: 200,
  cfCacheStatus: 'MISS',
  age: null,
  pop: 'BOM',
  sha256: '0123456789ab',
  ms: 42,
  ...over,
})

const info = (over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0',
  mode: 'production',
  seq: 1,
  pointerPath: 'catalogue/production.json',
  snapshotPath: 'catalogue/snapshots/1.json',
  snapshotSha256: SHA,
  featuredStoryId: null,
  stories: [{ storyId: 'blue-jackal', version: 1, packageSha256: SHA }],
  excluded: [{ storyId: 'two-paths', version: 2, reason: 'approval-missing' }],
  appVersion: '1ab6342c0ffee1ab6342c0ffee1ab6342c0ffee0',
  deploymentId: 'dpl_example',
  deploymentUrl: 'storyboard-abc123.vercel.app',
  builtAt: '2026-11-07T10:00:00.000Z',
  fetches: [fetchRow()],
  ...over,
})

describe('BuildInfo', () => {
  it('accepts a complete record', () => {
    const r = BuildInfo.safeParse(info())
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
  })

  it('accepts null Vercel values (local builds) and null header values', () => {
    const r = BuildInfo.safeParse(
      info({
        appVersion: null,
        deploymentId: null,
        deploymentUrl: null,
        fetches: [fetchRow({ cfCacheStatus: null, pop: null, age: 12 })],
      }),
    )
    expect(r.success).toBe(true)
  })

  it('records a network error as status null with no body hash', () => {
    const r = BuildInfo.safeParse(
      info({ fetches: [fetchRow({ status: null, sha256: null }), fetchRow()] }),
    )
    expect(r.success).toBe(true)
  })

  it('rejects unknown keys at the top level and in a fetch row', () => {
    expect(BuildInfo.safeParse(info({ extra: 1 })).success).toBe(false)
    expect(BuildInfo.safeParse(info({ fetches: [{ ...fetchRow(), url: 'x' }] })).success).toBe(
      false,
    )
  })

  it.each([
    ['a mode outside production and staging', { mode: 'fixtures' }],
    ['seq 0', { seq: 0 }],
    ['an empty fetch list', { fetches: [] }],
    ['a full-length sha256 in a fetch row', { fetches: [fetchRow({ sha256: SHA })] }],
    ['an uppercase sha256 in a fetch row', { fetches: [fetchRow({ sha256: '0123456789AB' })] }],
    ['a negative age', { fetches: [fetchRow({ age: -1 })] }],
    ['a fractional ms', { fetches: [fetchRow({ ms: 1.5 })] }],
    ['an empty appVersion', { appVersion: '' }],
    ['a builtAt with no time', { builtAt: '2026-11-07' }],
    ['an unknown exclusion reason', { excluded: [{ storyId: 'x-y', version: 1, reason: 'z' }] }],
  ])('rejects %s', (_why, over) => {
    expect(BuildInfo.safeParse(info(over)).success).toBe(false)
  })
})
