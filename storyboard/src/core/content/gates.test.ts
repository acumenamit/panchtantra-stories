import { describe, expect, it } from 'vitest'
import { jcsBytes, sha256Hex, toJcs } from '../hashing'
import { CataloguePointer, type CatalogueSnapshot } from '../package/catalogue'
import { StoryPackageV1 } from '../package/v1'
import {
  checkPointer,
  checkSnapshot,
  GATE_MODES,
  isPointerRoot,
  isSafeStoragePath,
  modeFromPointerPath,
  parseStrictJson,
  splitByApproval,
  STORAGE_GATE_MODES,
  type PointerLocation,
} from './gates'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const encode = (text: string) => new TextEncoder().encode(text)
const PROD: PointerLocation = { mode: 'production', root: '' }

const pointerValue = (over: Partial<CataloguePointer> = {}): CataloguePointer => ({
  schemaVersion: '1.0',
  seq: 3,
  snapshotPath: 'catalogue/snapshots/3.json',
  snapshotSha256: SHA_A,
  updatedAt: '2026-11-07T10:00:00.000Z',
  ...over,
})

const snapshotValue = (over: Partial<CatalogueSnapshot> = {}): CatalogueSnapshot => ({
  schemaVersion: '1.0',
  seq: 3,
  createdAt: '2026-11-07T10:00:00.000Z',
  note: 'gate test',
  featuredStoryId: null,
  stories: [
    {
      storyId: 'blue-jackal',
      collectionId: 'panchatantra',
      version: 1,
      packagePath: `packages/blue-jackal/${SHA_A}.json`,
      packageSha256: SHA_A,
      approvalSha256: SHA_B,
    },
    {
      storyId: 'two-paths',
      collectionId: 'panchatantra',
      version: 2,
      packagePath: `packages/two-paths/${SHA_B}.json`,
      packageSha256: SHA_B,
    },
  ],
  ...over,
})

/** Valid JSON with the same content as pointerValue(), but updatedAt first instead of last. */
const reordered = () => {
  const { updatedAt, ...rest } = pointerValue()
  return JSON.stringify({ updatedAt, ...rest })
}

/** A snapshot's bytes plus a pointer that names them with the matching hash. */
async function pair(bytes: Uint8Array<ArrayBuffer>, seq = 3) {
  return { bytes, pointer: pointerValue({ seq, snapshotSha256: await sha256Hex(bytes) }) }
}

describe('isSafeStoragePath', () => {
  it.each(['catalogue/snapshots/1.json', 'spikes/run/catalogue/production.json', 'a', '_x/y-z.v2'])(
    'accepts %s',
    (path) => expect(isSafeStoragePath(path)).toBe(true),
  )

  it.each([
    ['empty', ''],
    ['leading slash', '/catalogue/snapshots/1.json'],
    ['trailing slash', 'catalogue/snapshots/'],
    ['parent segment', 'catalogue/../masters/x.json'],
    ['double dot inside a name', 'catalogue/snapshots/1..json'],
    ['dot segment', 'catalogue/./1.json'],
    ['hidden name', 'catalogue/.env'],
    ['empty segment', 'catalogue//1.json'],
    ['query', 'catalogue/1.json?x=1'],
    ['fragment', 'catalogue/1.json#x'],
    ['backslash', 'catalogue\\1.json'],
    ['percent encoding', 'catalogue/%2e%2e/1.json'],
    ['space', 'catalogue/1 .json'],
    ['control character', 'catalogue/1\n.json'],
    ['too long', `${'a/'.repeat(300)}x`],
  ])('rejects a path with %s', (_why, path) => expect(isSafeStoragePath(path)).toBe(false))
})

describe('isPointerRoot', () => {
  it('accepts the empty root and safe roots ending with one slash', () => {
    expect(isPointerRoot('')).toBe(true)
    expect(isPointerRoot('spikes/run/')).toBe(true)
  })

  it.each(['spikes/run', '/spikes/', 'spikes//', '../', 'spikes/run//'])('rejects %j', (root) =>
    expect(isPointerRoot(root)).toBe(false),
  )
})

describe('modeFromPointerPath', () => {
  it('maps the two real pointer paths to their modes', () => {
    expect(modeFromPointerPath('catalogue/production.json')).toEqual({
      ok: true,
      value: { mode: 'production', root: '' },
    })
    expect(modeFromPointerPath('catalogue/staging.json')).toEqual({
      ok: true,
      value: { mode: 'staging', root: '' },
    })
  })

  it.each([
    'x/catalogue/production.json',
    '/catalogue/production.json',
    'catalogue/production.json.bak',
    'catalogue/production.json?x=1',
    'catalogue/other.json',
    'catalogue/snapshots/production.json',
    'spikes/run/catalogue/production.json',
    '',
  ])('rejects %j with the default roots', (path) => {
    expect(modeFromPointerPath(path)).toEqual({
      ok: false,
      reason:
        'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json',
    })
  })

  it('accepts a configured root exactly and nothing that only resembles it', () => {
    const roots = ['', 'spikes/run/']
    expect(modeFromPointerPath('spikes/run/catalogue/staging.json', roots)).toEqual({
      ok: true,
      value: { mode: 'staging', root: 'spikes/run/' },
    })
    expect(modeFromPointerPath('spikes/runx/catalogue/staging.json', roots).ok).toBe(false)
    expect(modeFromPointerPath('xspikes/run/catalogue/staging.json', roots).ok).toBe(false)
    expect(modeFromPointerPath('spikes/catalogue/staging.json', roots).ok).toBe(false)
  })

  it('never maps a Storage pointer path to fixtures mode, so the approval gate cannot be skipped', () => {
    const reason =
      'pointer path must be <root>catalogue/production.json or <root>catalogue/staging.json'
    expect(modeFromPointerPath('catalogue/fixtures.json')).toEqual({ ok: false, reason })
    expect(modeFromPointerPath('spikes/run/catalogue/fixtures.json', ['', 'spikes/run/'])).toEqual({
      ok: false,
      reason,
    })
  })

  it('keeps Storage pointer modes separate from build modes', () => {
    expect(GATE_MODES).toEqual(['production', 'staging', 'fixtures'])
    expect(STORAGE_GATE_MODES).toEqual(['production', 'staging'])
  })

  it('refuses an invalid root list instead of matching against it', () => {
    expect(modeFromPointerPath('spikescatalogue/production.json', ['spikes'])).toEqual({
      ok: false,
      reason: 'pointer root list contains an invalid root',
    })
  })
})

describe('checkPointer', () => {
  it('accepts canonical bytes and returns the parsed pointer', () => {
    expect(checkPointer(jcsBytes(pointerValue()), PROD)).toEqual({
      ok: true,
      value: pointerValue(),
    })
  })

  it('accepts a snapshot path under a non-empty root', () => {
    const p = pointerValue({ snapshotPath: 'spikes/run/catalogue/snapshots/3.json' })
    expect(checkPointer(jcsBytes(p), { mode: 'production', root: 'spikes/run/' }).ok).toBe(true)
  })

  it('rejects bytes that are not JSON', () => {
    expect(checkPointer(encode('{"seq":'), PROD)).toEqual({
      ok: false,
      reason: 'pointer is not valid UTF-8 JSON',
    })
  })

  it('rejects invalid UTF-8', () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]) // {"<0xff>":1}
    expect(checkPointer(bytes, PROD)).toEqual({
      ok: false,
      reason: 'pointer is not valid UTF-8 JSON',
    })
  })

  it('rejects an own "__proto__" key', () => {
    const text = toJcs(pointerValue()).replace('{', '{"__proto__":{},')
    expect(checkPointer(encode(text), PROD)).toEqual({
      ok: false,
      reason: 'pointer contains a "__proto__" key',
    })
  })

  it('rejects an unknown key (strict parse)', () => {
    const r = checkPointer(jcsBytes({ ...pointerValue(), extra: 1 }), PROD)
    expect(r).toEqual({
      ok: false,
      reason: expect.stringMatching(/^pointer failed strict parse: /),
    })
  })

  it('rejects a missing field (strict parse)', () => {
    const missing: Partial<CataloguePointer> = pointerValue()
    delete missing.updatedAt
    const r = checkPointer(jcsBytes(missing), PROD)
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('updatedAt') })
  })

  it('rejects a malformed snapshotSha256 (strict parse)', () => {
    const r = checkPointer(jcsBytes(pointerValue({ snapshotSha256: 'A'.repeat(64) })), PROD)
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('snapshotSha256') })
  })

  it.each([
    ['pretty-printed', JSON.stringify(pointerValue(), null, 2)],
    ['keys out of order', reordered()],
    ['trailing newline', `${toJcs(pointerValue())}\n`],
    ['a byte order mark', `﻿${toJcs(pointerValue())}`],
    ['a number written as 3.0', toJcs(pointerValue()).replace('"seq":3', '"seq":3.0')],
  ])('rejects non-canonical bytes: %s', (_why, text) => {
    expect(checkPointer(encode(text), PROD)).toEqual({
      ok: false,
      reason: expect.stringMatching(/^pointer is not (canonical JCS|valid UTF-8 JSON)$/),
    })
  })

  it('reports non-canonical bytes as such when the JSON itself is valid', () => {
    expect(checkPointer(encode(reordered()), PROD)).toEqual({
      ok: false,
      reason: 'pointer is not canonical JCS',
    })
  })

  it('rejects an unsafe snapshot path', () => {
    const p = pointerValue({ snapshotPath: 'catalogue/snapshots/../../masters/x.json' })
    expect(checkPointer(jcsBytes(p), PROD)).toEqual({
      ok: false,
      reason: 'pointer snapshotPath is unsafe',
    })
  })

  it('rejects a snapshot path outside <root>catalogue/snapshots/', () => {
    const p = pointerValue({ snapshotPath: 'packages/x/3.json' })
    expect(checkPointer(jcsBytes(p), PROD)).toEqual({
      ok: false,
      reason: 'pointer snapshotPath must sit under catalogue/snapshots/',
    })
  })

  it('rejects a snapshot path under a different root', () => {
    const p = pointerValue({ snapshotPath: 'catalogue/snapshots/3.json' })
    expect(checkPointer(jcsBytes(p), { mode: 'production', root: 'spikes/run/' })).toEqual({
      ok: false,
      reason: 'pointer snapshotPath must sit under spikes/run/catalogue/snapshots/',
    })
  })
})

describe('checkSnapshot', () => {
  it('includes every entry in staging mode', async () => {
    const { bytes, pointer } = await pair(jcsBytes(snapshotValue()))
    const r = await checkSnapshot(bytes, pointer, 'staging')
    expect(r.ok && r.value.included.map((s) => s.storyId)).toEqual(['blue-jackal', 'two-paths'])
    expect(r.ok && r.value.excluded).toEqual([])
  })

  it('includes every entry in fixtures mode (approval skipped)', async () => {
    const { bytes, pointer } = await pair(jcsBytes(snapshotValue()))
    const r = await checkSnapshot(bytes, pointer, 'fixtures')
    expect(r.ok && r.value.included.map((s) => s.storyId)).toEqual(['blue-jackal', 'two-paths'])
    expect(r.ok && r.value.excluded).toEqual([])
  })

  it('excludes entries without approvalSha256 in production mode', async () => {
    const { bytes, pointer } = await pair(jcsBytes(snapshotValue()))
    const r = await checkSnapshot(bytes, pointer, 'production')
    expect(r.ok && r.value.included.map((s) => s.storyId)).toEqual(['blue-jackal'])
    expect(r.ok && r.value.excluded.map((s) => s.storyId)).toEqual(['two-paths'])
    expect(r.ok && r.value.snapshot).toEqual(snapshotValue())
  })

  it('rejects bytes whose sha256 differs from the pointer', async () => {
    const r = await checkSnapshot(jcsBytes(snapshotValue()), pointerValue(), 'production')
    expect(r).toEqual({ ok: false, reason: 'snapshot sha256 mismatch' })
  })

  it('rejects bytes that are not JSON, even when the hash matches', async () => {
    const { bytes, pointer } = await pair(encode('not json'))
    expect(await checkSnapshot(bytes, pointer, 'production')).toEqual({
      ok: false,
      reason: 'snapshot is not valid UTF-8 JSON',
    })
  })

  it('rejects non-canonical bytes, even when the hash matches', async () => {
    const { bytes, pointer } = await pair(encode(JSON.stringify(snapshotValue(), null, 1)))
    expect(await checkSnapshot(bytes, pointer, 'production')).toEqual({
      ok: false,
      reason: 'snapshot is not canonical JCS',
    })
  })

  it('rejects an unknown key (strict parse), even when the hash matches', async () => {
    const { bytes, pointer } = await pair(jcsBytes({ ...snapshotValue(), extra: true }))
    const r = await checkSnapshot(bytes, pointer, 'production')
    expect(r).toEqual({
      ok: false,
      reason: expect.stringMatching(/^snapshot failed strict parse: /),
    })
  })

  it('rejects an own "__proto__" key in a story entry', async () => {
    const text = toJcs(snapshotValue()).replace(
      '{"approvalSha256"',
      '{"__proto__":1,"approvalSha256"',
    )
    const { bytes, pointer } = await pair(encode(text))
    expect(await checkSnapshot(bytes, pointer, 'production')).toEqual({
      ok: false,
      reason: 'snapshot contains a "__proto__" key',
    })
  })

  it('rejects a snapshot whose seq differs from the pointer', async () => {
    const { bytes, pointer } = await pair(jcsBytes(snapshotValue({ seq: 2 })), 3)
    expect(await checkSnapshot(bytes, pointer, 'production')).toEqual({
      ok: false,
      reason: 'snapshot seq 2 does not match pointer seq 3',
    })
  })
})

describe('splitByApproval', () => {
  it('keeps an empty catalogue empty in both modes', () => {
    const empty = snapshotValue({ stories: [] })
    expect(splitByApproval(empty, 'production')).toEqual({
      snapshot: empty,
      included: [],
      excluded: [],
    })
    expect(splitByApproval(empty, 'staging')).toEqual({
      snapshot: empty,
      included: [],
      excluded: [],
    })
  })

  it('treats fixtures like staging: every entry included, approved or not', () => {
    const snapshot = snapshotValue()
    expect(splitByApproval(snapshot, 'fixtures')).toEqual(splitByApproval(snapshot, 'staging'))
    expect(splitByApproval(snapshot, 'fixtures').included).toEqual(snapshot.stories)
  })
})

describe('parseStrictJson', () => {
  it('accepts valid JSON that is not canonical JCS and returns the raw value too', () => {
    const text = JSON.stringify(pointerValue(), null, 2)
    const r = parseStrictJson(encode(text), CataloguePointer, 'pointer')
    expect(r).toEqual({ ok: true, value: { raw: pointerValue(), data: pointerValue() } })
  })

  it('names the label in each failure', () => {
    expect(parseStrictJson(encode('{'), StoryPackageV1, 'package a-b')).toEqual({
      ok: false,
      reason: 'package a-b is not valid UTF-8 JSON',
    })
    expect(parseStrictJson(encode('{"__proto__":{}}'), StoryPackageV1, 'package a-b')).toEqual({
      ok: false,
      reason: 'package a-b contains a "__proto__" key',
    })
    expect(parseStrictJson(encode('{}'), StoryPackageV1, 'package a-b')).toEqual({
      ok: false,
      reason: expect.stringMatching(/^package a-b failed strict parse: /),
    })
  })
})
