// Media HEAD gate, pure parts (spec §3.2; design p1-step8-design.md §6.2, §6.3, §10.1; P1-2b).
import { describe, expect, it } from 'vitest'
import type { StoryPackageV1 } from '../package/v1'
import { mediaType } from '../../../tools/publisher/http'
import {
  acceptsByteRanges,
  judgeHead,
  MEDIA_EXTENSIONS,
  MEDIA_MAX_BYTES,
  mediaTypeOf,
  planMediaHeads,
  type HeadHeaders,
  type MediaPackage,
} from './media'

type Asset = StoryPackageV1['assets'][number]
type Variant = Asset['variants'][number]

const H1 = '1'.repeat(64)
const H2 = '2'.repeat(64)
const H3 = '3'.repeat(64)
const SHA = 'a'.repeat(64)
const provenance = { origin: 'human' as const }

const variant = (path: string, mime: Variant['mime'], bytes = 1000): Variant => ({
  path,
  mime,
  bytes,
})

const image = (...variants: Variant[]): Asset => ({
  kind: 'image',
  id: SHA,
  width: 800,
  height: 600,
  variants,
  provenance,
})

const audio = (v: Variant): Asset => ({
  kind: 'audio',
  id: SHA,
  nodeId: 'start',
  locale: 'en',
  durationMs: 1000,
  variants: [v],
  provenance,
  narratedTextSha256: SHA,
})

const story = (storyId: string, ...assets: Asset[]): MediaPackage => ({ pkg: { storyId, assets } })

/** A package with one image of one variant at `path`, for the pre-check cases. */
const one = (path: string, mime: Variant['mime'] = 'image/webp', bytes = 1000) => [
  story('blue-jackal', image(variant(path, mime, bytes))),
]

describe('planMediaHeads', () => {
  it('lists every variant of every asset in declaration order, with per-story totals', () => {
    const plan = planMediaHeads(
      [
        story(
          'blue-jackal',
          image(
            variant(`media/blue-jackal/${H1}-w800.webp`, 'image/webp', 100),
            variant(`media/blue-jackal/${H1}-og.jpg`, 'image/jpeg', 200),
          ),
          audio(variant(`media/blue-jackal/${H2}-hi.mp3`, 'audio/mpeg', 300)),
        ),
        story('one-pot-of-seeds'),
        story('two-paths', image(variant(`media/two-paths/${H3}-w800.webp`, 'image/webp', 400))),
      ],
      '',
    )
    expect(plan).toEqual({
      ok: true,
      value: {
        heads: [
          {
            storyId: 'blue-jackal',
            path: `media/blue-jackal/${H1}-w800.webp`,
            mime: 'image/webp',
            bytes: 100,
            order: 0,
          },
          {
            storyId: 'blue-jackal',
            path: `media/blue-jackal/${H1}-og.jpg`,
            mime: 'image/jpeg',
            bytes: 200,
            order: 1,
          },
          {
            storyId: 'blue-jackal',
            path: `media/blue-jackal/${H2}-hi.mp3`,
            mime: 'audio/mpeg',
            bytes: 300,
            order: 2,
          },
          {
            storyId: 'two-paths',
            path: `media/two-paths/${H3}-w800.webp`,
            mime: 'image/webp',
            bytes: 400,
            order: 3,
          },
        ],
        stories: [
          { storyId: 'blue-jackal', variants: 3, bytes: 600 },
          { storyId: 'one-pot-of-seeds', variants: 0, bytes: 0 },
          { storyId: 'two-paths', variants: 1, bytes: 400 },
        ],
      },
    })
  })

  it('plans nothing for phase-1 packages (no assets), but still lists each story', () => {
    expect(planMediaHeads([story('a-b'), story('c-d')], '')).toEqual({
      ok: true,
      value: {
        heads: [],
        stories: [
          { storyId: 'a-b', variants: 0, bytes: 0 },
          { storyId: 'c-d', variants: 0, bytes: 0 },
        ],
      },
    })
    expect(planMediaHeads([], '')).toEqual({ ok: true, value: { heads: [], stories: [] } })
  })

  it('puts media under the pointer root', () => {
    const path = `spikes/run/media/blue-jackal/${H1}-w800.webp`
    expect(planMediaHeads(one(path), 'spikes/run/').ok).toBe(true)
    expect(planMediaHeads(one(path), '')).toEqual({
      ok: false,
      reason: `package blue-jackal media ${path}: path must be media/blue-jackal/<64 hex>-<variant>.<ext>`,
    })
    expect(planMediaHeads(one(`media/blue-jackal/${H1}-w800.webp`), 'spikes/run/')).toEqual({
      ok: false,
      reason: `package blue-jackal media media/blue-jackal/${H1}-w800.webp: path must be spikes/run/media/blue-jackal/<64 hex>-<variant>.<ext>`,
    })
  })

  it.each([
    ['a parent segment', `media/blue-jackal/../x/${H1}-a.webp`],
    ['a leading slash', `/media/blue-jackal/${H1}-a.webp`],
    ['a query', `media/blue-jackal/${H1}-a.webp?x=1`],
    ['percent encoding', `media/blue-jackal/%2e%2e/${H1}-a.webp`],
    ['an empty path', ''],
  ])('1. refuses an unsafe path: %s', (_why, path) => {
    const r = planMediaHeads(one(path), '')
    expect(r).toEqual({
      ok: false,
      reason: expect.stringMatching(/^package blue-jackal media \S+: path is unsafe$/),
    })
  })

  it('1. prints an unsafe path only through the log sanitiser', () => {
    const path = `media/blue-jackal/\n${'x'.repeat(100)} .webp`
    expect(planMediaHeads(one(path), '')).toEqual({
      ok: false,
      reason: `package blue-jackal media media/blue-jackal/${'x'.repeat(46)}: path is unsafe`,
    })
  })

  it.each([
    ['another story prefix', `media/two-paths/${H1}-w800.webp`],
    ['no story folder', `media/${H1}-w800.webp`],
    ['a deeper folder', `media/blue-jackal/x/${H1}-w800.webp`],
    ['a short hash', `media/blue-jackal/${'1'.repeat(63)}-w800.webp`],
    ['a long hash', `media/blue-jackal/${'1'.repeat(65)}-w800.webp`],
    ['an uppercase hash', `media/blue-jackal/${'A'.repeat(64)}-w800.webp`],
    ['no variant name', `media/blue-jackal/${H1}.webp`],
    ['an empty variant name', `media/blue-jackal/${H1}-.webp`],
    ['an uppercase variant name', `media/blue-jackal/${H1}-W800.webp`],
    ['a variant name of 17 characters', `media/blue-jackal/${H1}-${'a'.repeat(17)}.webp`],
    ['an underscore in the variant name', `media/blue-jackal/${H1}-w_800.webp`],
    ['no extension', `media/blue-jackal/${H1}-w800`],
    ['an uppercase extension', `media/blue-jackal/${H1}-w800.WEBP`],
    ['outside media/', `packages/blue-jackal/${H1}-w800.webp`],
  ])('2. refuses a path that is not the media pattern: %s', (_why, path) => {
    expect(planMediaHeads(one(path), '')).toEqual({
      ok: false,
      reason: `package blue-jackal media ${path}: path must be media/blue-jackal/<64 hex>-<variant>.<ext>`,
    })
  })

  it('2. accepts a variant name of 16 characters', () => {
    expect(planMediaHeads(one(`media/blue-jackal/${H1}-${'a1'.repeat(8)}.webp`), '').ok).toBe(true)
  })

  it.each([
    ['image/webp', 'jpg', 'webp'],
    ['image/webp', 'png', 'webp'],
    ['image/jpeg', 'jpeg', 'jpg'],
    ['image/jpeg', 'webp', 'jpg'],
    ['audio/mpeg', 'mpeg', 'mp3'],
    ['audio/mpeg', 'webp', 'mp3'],
  ] as const)('3. refuses %s with the extension .%s', (mime, ext, want) => {
    const path = `media/blue-jackal/${H1}-x.${ext}`
    expect(planMediaHeads(one(path, mime), '')).toEqual({
      ok: false,
      reason: `package blue-jackal media ${path}: extension must be ${want} for ${mime}`,
    })
  })

  it('3. maps each declared mime to exactly one extension', () => {
    expect(MEDIA_EXTENSIONS).toEqual({
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'audio/mpeg': 'mp3',
    })
  })

  it('4. refuses a path declared twice in one package, never de-duplicating it', () => {
    const path = `media/blue-jackal/${H1}-w800.webp`
    const r = planMediaHeads(
      [
        story(
          'blue-jackal',
          image(variant(path, 'image/webp')),
          image(variant(path, 'image/webp')),
        ),
      ],
      '',
    )
    expect(r).toEqual({
      ok: false,
      reason: `package blue-jackal media ${path}: path is declared more than once`,
    })
  })

  it('4. refuses a path declared twice within one asset', () => {
    const path = `media/blue-jackal/${H1}-w800.webp`
    const r = planMediaHeads(
      [story('blue-jackal', image(variant(path, 'image/webp'), variant(path, 'image/webp')))],
      '',
    )
    expect(r.ok).toBe(false)
  })

  it('5. accepts exactly 10 MiB declared and refuses one byte more', () => {
    const path = `media/blue-jackal/${H2}-hi.mp3`
    expect(MEDIA_MAX_BYTES).toBe(10_485_760)
    expect(planMediaHeads(one(path, 'audio/mpeg', MEDIA_MAX_BYTES), '').ok).toBe(true)
    expect(planMediaHeads(one(path, 'audio/mpeg', MEDIA_MAX_BYTES + 1), '')).toEqual({
      ok: false,
      reason: `package blue-jackal media ${path}: declares 10485761 bytes; at most 10485760`,
    })
  })

  it('names the first violation in declaration order, before any later one', () => {
    const r = planMediaHeads(
      [
        story('blue-jackal', image(variant(`media/blue-jackal/${H1}-a.webp`, 'image/webp'))),
        story(
          'two-paths',
          image(variant(`media/two-paths/${H1}-a.jpg`, 'image/webp')), // 3. first
          image(variant('/unsafe', 'image/webp')), // 1. later
        ),
      ],
      '',
    )
    expect(r).toEqual({
      ok: false,
      reason: `package two-paths media media/two-paths/${H1}-a.jpg: extension must be webp for image/webp`,
    })
  })

  it('4. checks repeats across the whole build, not per package', () => {
    // The loader never passes one storyId twice (checkUniqueStoryIds); the rule still holds.
    const p = `media/blue-jackal/${H1}-a.webp`
    const r = planMediaHeads(
      [
        story('blue-jackal', image(variant(p, 'image/webp'))),
        story('blue-jackal', image(variant(p, 'image/webp'))),
      ],
      '',
    )
    expect(r).toEqual({
      ok: false,
      reason: `package blue-jackal media ${p}: path is declared more than once`,
    })
  })
})

/** Headers from a plain record; values are passed as is (no fetch normalisation). */
const headersOf = (values: Record<string, string>): HeadHeaders => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
})

const WEBP = { mime: 'image/webp', bytes: 1000 }
const MP3 = { mime: 'audio/mpeg', bytes: 52_431 }
const good = (over: Record<string, string> = {}) =>
  headersOf({ 'content-length': '1000', 'content-type': 'image/webp', ...over })

describe('judgeHead', () => {
  it('passes exactly 200 with the declared length and type', () => {
    expect(judgeHead(WEBP, 200, good())).toEqual({ ok: true })
    expect(
      judgeHead(MP3, 200, new Headers({ 'content-length': '52431', 'content-type': 'audio/mpeg' })),
    ).toEqual({ ok: true })
  })

  it.each([
    [304, 'status 304'],
    [400, 'status 400'],
    [404, 'status 404'],
    [403, 'status 403'],
    [503, 'status 503'],
    [429, 'status 429'],
    [204, 'status 204'],
    [206, 'status 206'],
    [300, 'status 300'],
    [301, 'redirect 301 (not followed)'],
    [302, 'redirect 302 (not followed)'],
    [303, 'redirect 303 (not followed)'],
    [307, 'redirect 307 (not followed)'],
    [308, 'redirect 308 (not followed)'],
  ])('fails status %i: %s', (status, reason) => {
    expect(judgeHead(WEBP, status, good())).toEqual({ ok: false, reason })
  })

  it('fails a missing content-length', () => {
    expect(judgeHead(WEBP, 200, headersOf({ 'content-type': 'image/webp' }))).toEqual({
      ok: false,
      reason: 'content-length missing',
    })
  })

  it.each([
    ['999', 'content-length 999 does not match declared 1000'],
    ['1001', 'content-length 1001 does not match declared 1000'],
    ['abc', 'content-length abc does not match declared 1000'],
    ['-1000', 'content-length -1000 does not match declared 1000'],
    ['1e3', 'content-length 1e3 does not match declared 1000'],
    ['1000.0', 'content-length 1000.0 does not match declared 1000'],
    ['1000, 1000', 'content-length 1000,1000 does not match declared 1000'],
    ['0000000001000', 'content-length 0000000001000 does not match declared 1000'],
    ['', 'content-length - does not match declared 1000'],
  ])('fails a content-length of %j', (length, reason) => {
    expect(judgeHead(WEBP, 200, good({ 'content-length': length }))).toEqual({ ok: false, reason })
  })

  it('accepts leading zeros within 12 digits, as the pattern allows', () => {
    expect(judgeHead(WEBP, 200, good({ 'content-length': '000000001000' }))).toEqual({ ok: true })
  })

  it.each(['audio/mpeg; charset=x', 'audio/mpeg;charset=binary', 'AUDIO/MPEG', ' audio/mpeg '])(
    'compares the media type without parameters: %j passes for audio/mpeg',
    (type) => {
      expect(
        judgeHead(MP3, 200, headersOf({ 'content-length': '52431', 'content-type': type })),
      ).toEqual({ ok: true })
    },
  )

  it.each([
    [
      MP3,
      'binary/octet-stream',
      'content-type binary/octet-stream does not match declared audio/mpeg',
    ],
    [
      MP3,
      'application/octet-stream',
      'content-type application/octet-stream does not match declared audio/mpeg',
    ],
    [WEBP, 'image/png', 'content-type image/png does not match declared image/webp'],
    [WEBP, 'image/jpeg', 'content-type image/jpeg does not match declared image/webp'],
    [WEBP, 'image/webp2', 'content-type image/webp2 does not match declared image/webp'],
    [WEBP, '', 'content-type none does not match declared image/webp'],
  ])('fails a content-type of %j', (v, type, reason) => {
    const length = String(v.bytes)
    expect(
      judgeHead(v, 200, headersOf({ 'content-length': length, 'content-type': type })),
    ).toEqual({ ok: false, reason })
  })

  it('fails a missing content-type', () => {
    expect(judgeHead(WEBP, 200, headersOf({ 'content-length': '1000' }))).toEqual({
      ok: false,
      reason: 'content-type none does not match declared image/webp',
    })
  })

  it('prints header values only through the log sanitiser', () => {
    const r = judgeHead(WEBP, 200, good({ 'content-type': `text/ht ml\n${'x'.repeat(100)}` }))
    expect(r).toEqual({
      ok: false,
      reason: `content-type text/html${'x'.repeat(55)} does not match declared image/webp`,
    })
  })

  it.each(['br', 'gzip', 'deflate', 'identity, gzip', ''])(
    'fails a content-encoding of %j',
    (encoding) => {
      expect(judgeHead(WEBP, 200, good({ 'content-encoding': encoding }))).toEqual({
        ok: false,
        reason: `content-encoding ${encoding.replace(/ /g, '') || '-'} is not identity`,
      })
    },
  )

  it.each(['identity', 'IDENTITY', 'Identity'])('passes a content-encoding of %j', (encoding) => {
    expect(judgeHead(WEBP, 200, good({ 'content-encoding': encoding }))).toEqual({ ok: true })
  })

  it('checks status, then length, then type, then encoding', () => {
    const all = headersOf({ 'content-type': 'image/png', 'content-encoding': 'br' })
    expect(judgeHead(WEBP, 404, all)).toEqual({ ok: false, reason: 'status 404' })
    expect(judgeHead(WEBP, 200, all)).toEqual({ ok: false, reason: 'content-length missing' })
    const typed = headersOf({
      'content-length': '1000',
      'content-type': 'image/png',
      'content-encoding': 'br',
    })
    expect(judgeHead(WEBP, 200, typed)).toEqual({
      ok: false,
      reason: 'content-type image/png does not match declared image/webp',
    })
    expect(judgeHead(WEBP, 200, good({ 'content-encoding': 'br' }))).toEqual({
      ok: false,
      reason: 'content-encoding br is not identity',
    })
  })

  it('reads a fetch Headers object, whose names are case-insensitive', () => {
    const h = new Headers({ 'Content-Length': '1000', 'Content-Type': 'image/webp; q=1' })
    expect(judgeHead(WEBP, 200, h)).toEqual({ ok: true })
  })
})

describe('acceptsByteRanges', () => {
  it.each([
    ['bytes', true],
    ['Bytes', true],
    ['none, bytes', true],
    ['none', false],
    ['', false],
  ])('%j gives %s', (value, expected) => {
    expect(acceptsByteRanges(headersOf({ 'accept-ranges': value }))).toBe(expected)
  })

  it('is false when the header is absent', () => {
    expect(acceptsByteRanges(headersOf({}))).toBe(false)
  })
})

describe('mediaTypeOf', () => {
  it('follows the publisher rule (tools/publisher/http.ts mediaType) exactly', () => {
    for (const value of [
      'application/json; charset=utf-8',
      'AUDIO/MPEG',
      ' image/webp ;x=y',
      '',
      ';',
      'text/plain;',
      null,
    ]) {
      expect(mediaTypeOf(value)).toBe(mediaType(value))
    }
  })
})
