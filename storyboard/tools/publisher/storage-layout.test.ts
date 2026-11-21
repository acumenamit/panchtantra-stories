// Step 13 (P1-8b) layer 1: the pure Storage layout (design p1-step13-design.md §3.3, §13.3).
// Titles start with their T13 id. One expect.soft per claim, messages "(gN) ..."; preconditions are
// hard expects starting "precondition:". No request is made anywhere in this file.
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/packages/two-paths.json'
import { MAX_BODY_BYTES } from '../../scripts/content/request'
import {
  expectedPackagePath,
  expectedSnapshotPath,
  isSafeStoragePath,
  modeFromPointerPath,
} from '../../src/core/content/gates'
import {
  MEDIA_EXTENSIONS,
  MEDIA_MAX_BYTES,
  planMediaHeads,
  type MediaPackage,
} from '../../src/core/content/media'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { Sha256, StoryId } from '../../src/core/package/v1'
import {
  classOfPath,
  contentReadTarget,
  MASTERS_CACHE_SECONDS,
  MAX_JSON_BYTES,
  pointerTarget,
  recheckTarget,
  recheckUrl,
  targetOf,
  type Refusal,
  type Target,
} from './storage-layout'

// ---- shared material (13.2.1) ----

const RECORDER_URL = new URL('http://127.0.0.1:9')
const HTTPS_URL = new URL('https://abcdefghijklmnopqrst.supabase.co')
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const PKG = jcsBytes(fixture)
const PKG_SHA = await sha256Hex(PKG)
const WAIVER = new TextEncoder().encode('{"waivers":[]}')
const WAIVER_SHA = await sha256Hex(WAIVER)
const MIMES = ['image/webp', 'image/jpeg', 'audio/mpeg'] as const

const PACKAGE_REF = () => ({ kind: 'package', storyId: 'two-paths', packageSha256: PKG_SHA })
const MEDIA_REF = (mime: string = 'image/webp') => ({
  kind: 'media',
  storyId: 'lion-and-hare',
  sha256: SHA_A,
  variant: 'w640',
  mime,
})
const SNAPSHOT_REF = () => ({ kind: 'snapshot', seq: 7 })
const APPROVAL_REF = () => ({ kind: 'approval', storyId: 'two-paths', packageSha256: SHA_A })
const WAIVER_REF = () => ({ kind: 'waiver', storyId: 'lion-and-hare', waiverSha256: WAIVER_SHA })

type Ref = Record<string, unknown>
type Layout = { ok: true; value: Target } | { ok: false; refusal: Refusal }

const refusal = (cls: string, stage: string, rule: string) => ({ cls, stage, rule })
const refusalOf = (result: { ok: boolean; refusal?: Refusal }) =>
  result.ok ? 'accepted' : result.refusal
const valueOf = (result: Layout): Target => {
  expect(result.ok, 'precondition: the layout accepted the ref').toBe(true)
  return (result as { ok: true; value: Target }).value
}

// ---- form catalogue FORMS13 (13.2.4) ----

type Form = readonly [id: string, value: unknown]
const VARIANT_RULE = /^[a-z0-9]{1,16}$/

const STRING_FORMS: readonly Form[] = [
  ['F-C1', 'Lion-and-hare'],
  ['F-C2', 'LION-AND-HARE'],
  ['F-C3', 'A'.repeat(64)],
  ['F-C4', 'aB'.repeat(32)],
  ['F-S1', 'a/b'],
  ['F-S2', 'a\\b'],
  ['F-S3', '.'],
  ['F-S4', '..'],
  ['F-S5', 'a/../b'],
  ['F-S6', 'a//b'],
  ['F-S7', '/lion-and-hare'],
  ['F-S8', 'lion-and-hare/'],
  ['F-S9', './lion-and-hare'],
  ['F-E1', '%2e%2e'],
  ['F-E2', '%2E%2E'],
  ['F-E3', 'a%2Fb'],
  ['F-E4', 'a%252eb'],
  ['F-E5', 'a%00b'],
  ['F-U1', 'lion／hare'],
  ['F-U2', 'lion-аnd-hare'],
  ['F-U3', 'lion‍hare'],
  ['F-U4', 'lion‮hare'],
  ['F-U5', 'lion hare'],
  ['F-N1', 'lion\u0000hare'],
  ['F-N2', 'lion\nhare'],
  ['F-N3', 'lion\rhare'],
  ['F-N4', 'lion\thare'],
  ['F-N5', 'lion\u007fhare'],
  ['F-N6', 'lion-and-hare '],
  ['F-N7', ' lion-and-hare'],
  ['F-L1', 'ab'],
  ['F-L2', 'a'.repeat(65)],
  ['F-L3', 'a'.repeat(600)],
  ['F-Q1', 'lion?x-upsert=true'],
  ['F-Q2', 'lion#x'],
  ['F-Q3', 'lion;x'],
  ['F-M1', '-lion'],
  ['F-M2', 'lion-'],
  ['F-M3', 'lion--hare'],
  ['F-M4', 'lion_hare'],
  ['F-M5', 'lion.hare'],
  ['F-X1', 'lion.json'],
  ['F-X2', 'x.json/'],
  ['F-X3', '.json.txt'],
  ['F-X4', `${'a'.repeat(64)}.json`],
]

const typeForms = (valid: string): readonly Form[] => [
  ['F-Y1', [valid]],
  ['F-Y2', new String(valid)],
  ['F-Y3', { toString: () => valid }],
  ['F-Y4', 123],
  ['F-Y5', null],
  ['F-Y6', undefined],
  ['F-Y7', Symbol('x')],
  ['F-Y8', true],
]

const SEQ_FORMS: readonly Form[] = [
  ['Z1', 0],
  ['Z2', -1],
  ['Z3', 1.5],
  ['Z4', Number.NaN],
  ['Z5', Number.POSITIVE_INFINITY],
  ['Z6', 2 ** 53],
  ['Z7', '1'],
  ['Z8', 1n],
  ['Z9', new Number(1)],
  ['Z10', -0],
  ['Z11', '1.json'],
  ['Z12', null],
]

const MIME_FORMS: readonly Form[] = [
  ['MM1', 'image/png'],
  ['MM2', 'IMAGE/WEBP'],
  ['MM3', 'audio/mpeg; charset=x'],
  ['MM4', 'toString'],
  ['MM5', 'constructor'],
  ['MM6', '__proto__'],
  ['MM7', 'hasOwnProperty'],
  ['MM8', 'audio/mpeg\r\nx-upsert: true'],
  ['MM9', 'image/jpg'],
  ['MM10', ''],
]

const MODE_FORMS: readonly Form[] = [
  ['MD1', 'fixtures'],
  ['MD2', 'Production'],
  ['MD3', 'production '],
  ['MD4', 'catalogue/production'],
  ['MD5', ''],
  ['MD6', '__proto__'],
  ['MD7', 'toString'],
  ['MD8', 1],
  ['MD9', null],
  ['MD10', new String('production')],
  ['MD11', 'production.json'],
  ['MD12', 'staging\u0000'],
]

const KIND_FORMS: readonly Form[] = [
  ['K1', 'Approval'],
  ['K2', 'APPROVAL'],
  ['K3', ' approval'],
  ['K4', 'approval\u0000'],
  ['K5', 'constructor'],
  ['K6', 'toString'],
  ['K7', '__proto__'],
  ['K8', 'hasOwnProperty'],
  ['K9', 'valueOf'],
  ['K10', 'listing'],
  ['K11', 'canary'],
  ['K12', 'media-log'],
  ['K13', 'image'],
  ['K14', 'report'],
  ['K15', 'masters'],
  ['K16', ''],
  ['K17', ['approval']],
]

type FieldRule = 'story-id' | 'sha256' | 'variant' | 'mime' | 'seq'

/** The real rule each field must pass (v1.ts:10-18, media.ts:12-21, catalogue.ts:60). */
function realRuleAccepts(rule: FieldRule, value: unknown): boolean {
  if (rule === 'story-id') return typeof value === 'string' && StoryId.safeParse(value).success
  if (rule === 'sha256') return typeof value === 'string' && Sha256.safeParse(value).success
  if (rule === 'variant') return typeof value === 'string' && VARIANT_RULE.test(value)
  if (rule === 'mime') return typeof value === 'string' && Object.hasOwn(MEDIA_EXTENSIONS, value)
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

const VALID_OF: Record<FieldRule, string> = {
  'story-id': 'lion-and-hare',
  sha256: SHA_A,
  variant: 'w640',
  mime: 'image/webp',
  seq: '7',
}

/** The string forms of one field, without types; each fails the field's real rule. */
function stringFormsFor(rule: FieldRule): readonly Form[] {
  if (rule === 'seq') return SEQ_FORMS
  if (rule === 'mime') return MIME_FORMS
  const extra: Form[] =
    rule === 'sha256'
      ? [['F-L4', 'a'.repeat(63)]]
      : rule === 'variant'
        ? [['F-L6', 'v'.repeat(17)]]
        : []
  return [...STRING_FORMS.filter(([id]) => !(rule === 'variant' && id === 'F-L1')), ...extra]
}

/** Every form of one field, types included. */
function allFormsFor(rule: FieldRule): readonly Form[] {
  return rule === 'seq' ? SEQ_FORMS : [...stringFormsFor(rule), ...typeForms(VALID_OF[rule])]
}

const CLASS_FIELDS: Record<string, readonly (readonly [string, FieldRule])[]> = {
  package: [
    ['storyId', 'story-id'],
    ['packageSha256', 'sha256'],
  ],
  media: [
    ['storyId', 'story-id'],
    ['sha256', 'sha256'],
    ['variant', 'variant'],
    ['mime', 'mime'],
  ],
  snapshot: [['seq', 'seq']],
  approval: [
    ['storyId', 'story-id'],
    ['packageSha256', 'sha256'],
  ],
  waiver: [
    ['storyId', 'story-id'],
    ['waiverSha256', 'sha256'],
  ],
}

const VALID_REF: Record<string, () => Ref> = {
  package: PACKAGE_REF,
  media: () => MEDIA_REF(),
  snapshot: SNAPSHOT_REF,
  approval: APPROVAL_REF,
  waiver: WAIVER_REF,
}

function expectFieldForms(
  cls: string,
  field: string,
  rule: FieldRule,
  forms: readonly Form[],
  group = 'g1',
): void {
  for (const [id, value] of forms) {
    expect(realRuleAccepts(rule, value), `precondition: ${field} ${id} fails the real rule`).toBe(
      false,
    )
    const ref = { ...VALID_REF[cls]!(), [field]: value }
    expect
      .soft(refusalOf(targetOf(ref)), `(${group}) ${cls} ${field} ${id}`)
      .toEqual(refusal(cls, 'field', rule))
  }
}

// ---- PR-1 forms and safe-but-wrong paths ----

const PR1_FORMS: readonly Form[] = [
  ['P01', 'a/%2e%2e/b'],
  ['P02', 'a/%2E%2E/b'],
  ['P03', 'a/./b'],
  ['P04', 'a/../b'],
  ['P05', 'a//b'],
  ['P06', 'a\\b'],
  ['P07', 'a/%2f/b'],
  ['P08', 'a/%252e%252e/b'],
  ['P09', 'a/b?x'],
  ['P10', 'a/b#x'],
  ['P11', 'a/\u0000b'],
  ['P12', 'a/\tb'],
  ['P13', 'a/\nb'],
  ['P14', 'a/b '],
  ['P15', 'a／b'],
  ['P16', 'аpprovals/x'],
]
const UNCHANGED_BY_PARSER = new Set(['P05', 'P07', 'P08'])

const SW_PATHS: readonly (readonly [string, string])[] = [
  ['SW1', `approvals/Lion-And-Hare/${SHA_A}.json`],
  ['SW2', `approvals/lion_and_hare/${SHA_A}.json`],
  ['SW3', `approvals/lion.and.hare/${SHA_A}.json`],
  ['SW4', `approvals/ab/${SHA_A}.json`],
  ['SW5', `approvals/${'a'.repeat(65)}/${SHA_A}.json`],
  ['SW6', `approvals/lion--hare/${SHA_A}.json`],
  ['SW7', `approvals/lion-and-hare-/${SHA_A}.json`],
  ['SW8', `approvals/two-paths/${SHA_A.toUpperCase()}.json`],
  ['SW9', `approvals/two-paths/${'a'.repeat(63)}.json`],
  ['SW10', `approvals/two-paths/${SHA_A}.JSON`],
  ['SW11', `approvals/two-paths/${SHA_A}.json.txt`],
  ['SW19', `approvals/two-paths/${SHA_A}`],
  ['SW12', `approvals/x/y/${SHA_A}.json`],
  ['SW13', `approvals-x/two-paths/${SHA_A}.json`],
  ['SW14', `Approvals/two-paths/${SHA_A}.json`],
  ['SW15', 'canary.txt'],
  ['SW16', 'media-log/x.ndjson'],
  ['SW17', 'lion-and-hare/images/a.png'],
  ['SW18', 'lion-and-hare/reports/r.json'],
]

const NEAR_MISS_IDS = ['approvals', 'waivers', 'media-log', 'reports', 'images', 'abc']
const NA_STORY_IDS = [...NEAR_MISS_IDS, 'a'.repeat(64), '123', 'a-b-c']

const approvalTarget = (path: string, bucket: 'content' | 'masters' = 'masters'): Target => ({
  kind: 'approval',
  bucket,
  path,
  contentType: 'application/json',
  cacheSeconds: 0,
  maxBytes: MAX_JSON_BYTES,
  fields: Object.freeze({ storyId: 'two-paths', packageSha256: SHA_A }),
})

const MASTERS_ROUTE = '/storage/v1/object/masters/'

// ---- the toml reader behind the drift tests (guard G6; reader code is guard code) ----

function stripTomlComment(line: string): string {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === '#' && !quoted) return line.slice(0, i)
  }
  return line
}

/** The key = value lines of one [section], comments skipped; throws when the section is missing. */
function tomlSection(text: string, section: string): Map<string, string> {
  const values = new Map<string, string>()
  let current: string | null = null
  let found = false
  for (const raw of text.split(/\r?\n/)) {
    const line = stripTomlComment(raw).trim()
    if (line === '') continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      current = header[1]!.trim()
      if (current === section) found = true
      continue
    }
    if (current !== section) continue
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line)
    if (pair) values.set(pair[1]!, pair[2]!.trim())
  }
  if (!found) throw new Error(`section ${section} not found`)
  return values
}

function tomlKey(values: Map<string, string>, key: string): string {
  const value = values.get(key)
  if (value === undefined) throw new Error(`key ${key} missing`)
  return value
}

function tomlSize(value: string): number {
  const match = /^"(\d+)(MiB|KiB)"$/.exec(value)
  if (!match) throw new Error('unknown size unit')
  return Number(match[1]) * (match[2] === 'MiB' ? 1024 * 1024 : 1024)
}

function tomlStrings(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    throw new Error('not a string array')
  }
  return parsed as string[]
}

const CONFIG_TOML = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

// ---- tests ----

describe('storage-layout: targetOf and pointerTarget', () => {
  it('T13-L1 targetOf builds bucket, path, content type, cache, cap and a frozen copy of the fields per class', () => {
    const cases: [string, Ref, Target][] = [
      [
        'package',
        PACKAGE_REF(),
        {
          kind: 'package',
          bucket: 'content',
          path: `packages/two-paths/${PKG_SHA}.json`,
          contentType: 'application/json',
          cacheSeconds: 3600,
          maxBytes: MAX_JSON_BYTES,
          fields: { storyId: 'two-paths', packageSha256: PKG_SHA },
        },
      ],
      ...MIMES.map((mime): [string, Ref, Target] => [
        `media ${mime}`,
        MEDIA_REF(mime),
        {
          kind: 'media',
          bucket: 'content',
          path: `media/lion-and-hare/${SHA_A}-w640.${{ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3' }[mime]}`,
          contentType: mime,
          cacheSeconds: 3600,
          maxBytes: MEDIA_MAX_BYTES,
          fields: { storyId: 'lion-and-hare', sha256: SHA_A, variant: 'w640', mime },
        },
      ]),
      [
        'snapshot',
        SNAPSHOT_REF(),
        {
          kind: 'snapshot',
          bucket: 'content',
          path: 'catalogue/snapshots/7.json',
          contentType: 'application/json',
          cacheSeconds: 3600,
          maxBytes: MAX_JSON_BYTES,
          fields: { seq: 7 },
        },
      ],
      [
        'approval',
        APPROVAL_REF(),
        {
          kind: 'approval',
          bucket: 'masters',
          path: `approvals/two-paths/${SHA_A}.json`,
          contentType: 'application/json',
          cacheSeconds: 0,
          maxBytes: MAX_JSON_BYTES,
          fields: { storyId: 'two-paths', packageSha256: SHA_A },
        },
      ],
      [
        'waiver',
        WAIVER_REF(),
        {
          kind: 'waiver',
          bucket: 'masters',
          path: `waivers/lion-and-hare/${WAIVER_SHA}.json`,
          contentType: null,
          cacheSeconds: null,
          maxBytes: MAX_JSON_BYTES,
          fields: { storyId: 'lion-and-hare', waiverSha256: WAIVER_SHA },
        },
      ],
    ]
    expect(new Set(cases.map(([, ref]) => JSON.stringify(ref))).size, 'precondition: 7 refs').toBe(
      7,
    )
    for (const [name, ref, want] of cases) {
      const got = valueOf(targetOf(ref))
      expect.soft(got.bucket, `(g1) bucket ${name}`).toBe(want.bucket)
      expect.soft(got.path, `(g2) path ${name}`).toBe(want.path)
      expect.soft(got.contentType, `(g3) contentType ${name}`).toBe(want.contentType)
      expect.soft(got.cacheSeconds, `(g4) cacheSeconds ${name}`).toBe(want.cacheSeconds)
      expect.soft(got.maxBytes, `(g5) maxBytes ${name}`).toBe(want.maxBytes)
      expect.soft({ ...got.fields }, `(g6) fields ${name}`).toEqual(want.fields)
      expect.soft(Object.isFrozen(got.fields), `(g6) fields frozen ${name}`).toBe(true)
      expect.soft(got.fields === (ref as unknown), `(g6) fields not the ref ${name}`).toBe(false)
      expect.soft(got, `(g7) exact shape ${name}`).toStrictEqual(want)
    }
    expect.soft(MASTERS_CACHE_SECONDS, '(g4) MASTERS_CACHE_SECONDS').toBe(0)
  })

  it('T13-L2 pointerTarget accepts production and staging only', () => {
    for (const mode of ['production', 'staging'] as const) {
      expect.soft(pointerTarget(mode), `(g1) ${mode}`).toStrictEqual({
        ok: true,
        value: {
          kind: 'pointer',
          bucket: 'content',
          path: `catalogue/${mode}.json`,
          contentType: 'application/json',
          cacheSeconds: 0,
          maxBytes: MAX_JSON_BYTES,
          fields: { mode },
        },
      })
    }
    for (const [id, mode] of MODE_FORMS) {
      expect
        .soft(refusalOf(pointerTarget(mode)), `(g2) ${id}`)
        .toEqual(refusal('pointer', 'field', 'mode'))
    }
  })

  it('T13-L3 field accept edges pass: storyId bounds and near misses, hex, variant bounds, seq bounds, every mime, a null-prototype ref', () => {
    const storyIds = ['abc', 'a'.repeat(64), '123', 'a-b-c', ...NA_STORY_IDS]
    for (const storyId of storyIds) {
      expect(StoryId.safeParse(storyId).success, `precondition: ${storyId} is a StoryId`).toBe(true)
      expect.soft(targetOf({ ...APPROVAL_REF(), storyId }).ok, `(g1) storyId ${storyId}`).toBe(true)
    }
    for (const sha of [SHA_A, '0123456789abcdef'.repeat(4)]) {
      expect(Sha256.safeParse(sha).success, 'precondition: a Sha256').toBe(true)
      expect
        .soft(targetOf({ ...APPROVAL_REF(), packageSha256: sha }).ok, `(g1) sha ${sha}`)
        .toBe(true)
    }
    for (const variant of ['a', 'v'.repeat(16)]) {
      expect.soft(targetOf({ ...MEDIA_REF(), variant }).ok, `(g1) variant ${variant}`).toBe(true)
    }
    for (const seq of [1, Number.MAX_SAFE_INTEGER]) {
      expect.soft(targetOf({ kind: 'snapshot', seq }).ok, `(g1) seq ${seq}`).toBe(true)
    }
    for (const mime of Object.keys(MEDIA_EXTENSIONS)) {
      expect.soft(targetOf(MEDIA_REF(mime)).ok, `(g1) mime ${mime}`).toBe(true)
    }
    const bare = Object.assign(Object.create(null) as Ref, APPROVAL_REF())
    expect.soft(targetOf(bare).ok, '(g1) null prototype').toBe(true)
  })

  const FIELD_FAMILIES: [string, string, string, FieldRule][] = [
    ['T13-L4a', 'approval', 'storyId', 'story-id'],
    ['T13-L4b', 'approval', 'packageSha256', 'sha256'],
    ['T13-L4c', 'media', 'variant', 'variant'],
    ['T13-L4d', 'media', 'mime', 'mime'],
    ['T13-L4e', 'snapshot', 'seq', 'seq'],
  ]
  for (const [id, cls, field, rule] of FIELD_FAMILIES) {
    it(`${id} every ${field} form is refused at stage field with rule ${rule}`, () => {
      expect(targetOf(VALID_REF[cls]!()).ok, 'precondition: the valid ref passes').toBe(true)
      expectFieldForms(cls, field, rule, stringFormsFor(rule))
    })
  }

  it('T13-L5 type confusion in every string field of every class is refused with the field rule', () => {
    for (const [cls, fields] of Object.entries(CLASS_FIELDS)) {
      for (const [field, rule] of fields) {
        if (rule === 'seq') continue
        expectFieldForms(cls, field, rule, typeForms(VALID_OF[rule]))
      }
    }
  })

  it('T13-L6 every unknown kind is refused as ref field kind-unknown', () => {
    for (const [id, kind] of KIND_FORMS) {
      // A throw is caught per sample, so a kind lookup that crashes on K5 still reports K6-K9.
      let outcome: unknown
      try {
        outcome = refusalOf(targetOf({ ...APPROVAL_REF(), kind }))
      } catch (error) {
        outcome = `threw ${error instanceof Error ? error.name : typeof error}`
      }
      expect.soft(outcome, `(g1) ${id}`).toEqual(refusal('ref', 'field', 'kind-unknown'))
    }
  })

  it('T13-L7a refused ref shapes: not an object, a foreign prototype, wrong own keys and accessors', () => {
    expect(targetOf(APPROVAL_REF()).ok, 'precondition: the valid ref passes').toBe(true)
    class Instance {
      kind = 'approval'
      storyId = 'two-paths'
      packageSha256 = SHA_A
    }
    const shapes: [string, unknown, ReturnType<typeof refusal>][] = [
      ['null', null, refusal('ref', 'field', 'ref-not-object')],
      ['array', [], refusal('ref', 'field', 'ref-not-object')],
      ['function', () => APPROVAL_REF(), refusal('ref', 'field', 'ref-not-object')],
      ['string', 'approval', refusal('ref', 'field', 'ref-not-object')],
      ['class instance', new Instance(), refusal('ref', 'field', 'ref-prototype')],
      [
        'Object.create(validRef)',
        Object.create(APPROVAL_REF()),
        refusal('ref', 'field', 'ref-prototype'),
      ],
    ]
    for (const extra of ['upsert', 'bucket', 'path', 'contentType', 'cacheControl']) {
      shapes.push([
        `extra ${extra}`,
        { ...APPROVAL_REF(), [extra]: extra === 'upsert' ? true : 'x' },
        refusal('approval', 'field', 'ref-keys'),
      ])
    }
    const missing: Ref = APPROVAL_REF()
    delete missing.packageSha256
    shapes.push(['missing key', missing, refusal('approval', 'field', 'ref-keys')])
    shapes.push([
      'symbol key',
      { ...APPROVAL_REF(), [Symbol('x')]: 1 },
      refusal('approval', 'field', 'ref-keys'),
    ])
    const hiddenExtra = APPROVAL_REF()
    Object.defineProperty(hiddenExtra, 'path', { value: 'x', enumerable: false })
    shapes.push(['non-enumerable extra key', hiddenExtra, refusal('approval', 'field', 'ref-keys')])
    const hiddenField = APPROVAL_REF() as Ref
    Object.defineProperty(hiddenField, 'storyId', { value: 'two-paths', enumerable: false })
    shapes.push(['non-enumerable field', hiddenField, refusal('approval', 'field', 'ref-keys')])
    const proto = JSON.parse(
      `{"kind":"approval","storyId":"two-paths","packageSha256":"${SHA_A}","__proto__":{"x":1}}`,
    ) as Ref
    expect(Object.hasOwn(proto, '__proto__'), 'precondition: an own __proto__ key').toBe(true)
    shapes.push(['own __proto__', proto, refusal('approval', 'field', 'ref-keys')])
    for (const field of ['storyId', 'packageSha256', 'kind']) {
      const ref = APPROVAL_REF() as Ref
      const value = ref[field]
      Object.defineProperty(ref, field, { get: () => value, enumerable: true })
      shapes.push([
        `getter ${field}`,
        ref,
        refusal(field === 'kind' ? 'ref' : 'approval', 'field', 'ref-accessor'),
      ])
    }
    for (const [name, ref, want] of shapes) {
      expect.soft(refusalOf(targetOf(ref)), `(g1) ${name}`).toEqual(want)
    }
  })

  it('T13-L7b frozen and null-prototype refs pass, and a Proxy cannot answer twice: no get trap, one descriptor read per key', () => {
    expect.soft(targetOf(Object.freeze(APPROVAL_REF())).ok, '(g0) frozen').toBe(true)
    // (g1) a get trap that counts and flips
    let gets = 0
    let ownKeys = 0
    const flipping = new Proxy(APPROVAL_REF(), {
      get(target, key, receiver) {
        gets++
        return key === 'storyId' ? 'fox-and-crow' : Reflect.get(target, key, receiver)
      },
      ownKeys(target) {
        ownKeys++
        return Reflect.ownKeys(target)
      },
    })
    const first = targetOf(flipping)
    expect(ownKeys, 'precondition: the ownKeys trap ran').toBeGreaterThanOrEqual(1)
    expect
      .soft(first.ok && first.value.path, '(g1) path from descriptor values')
      .toBe(`approvals/two-paths/${SHA_A}.json`)
    expect.soft(gets, '(g1) get trap calls').toBe(0)
    // (g2) a descriptor trap that flips on its second call per key
    const calls = new Map<PropertyKey, number>()
    let ownKeys2 = 0
    const twice = new Proxy(APPROVAL_REF(), {
      ownKeys(target) {
        ownKeys2++
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        const n = (calls.get(key) ?? 0) + 1
        calls.set(key, n)
        const d = Reflect.getOwnPropertyDescriptor(target, key)
        return n >= 2 && key === 'storyId' && d ? { ...d, value: 'fox-and-crow' } : d
      },
    })
    const second = targetOf(twice)
    expect(ownKeys2, 'precondition: the ownKeys trap ran').toBeGreaterThanOrEqual(1)
    expect
      .soft(second.ok && second.value.path, '(g2) path uses the first value')
      .toBe(`approvals/two-paths/${SHA_A}.json`)
    expect.soft([...calls.values()], '(g2) one descriptor call per key').toEqual([1, 1, 1])
  })

  const CLASS_IDS: [string, string][] = [
    ['T13-L8a', 'package'],
    ['T13-L8b', 'media'],
    ['T13-L8c', 'snapshot'],
    ['T13-L8d', 'approval'],
    ['T13-L8e', 'waiver'],
  ]
  for (const [id, cls] of CLASS_IDS) {
    it(`${id} every form in every ${cls} field is refused at stage field with the field rule`, () => {
      expect(targetOf(VALID_REF[cls]!()).ok, 'precondition: the class valid ref passes').toBe(true)
      for (const [field, rule] of CLASS_FIELDS[cls]!) {
        expectFieldForms(cls, field, rule, allFormsFor(rule))
      }
    })
  }
})

describe('storage-layout: re-check 1, re-check 2 and classOfPath', () => {
  it('T13-L9a re-check 1 refuses every PR-1 form in an id segment as class-pattern unsafe-path', () => {
    const shapes: [string, (p: string) => Target][] = [
      ['approval', (p) => approvalTarget(`approvals/${p}/${SHA_A}.json`)],
      [
        'waiver',
        (p) => ({
          ...approvalTarget(`waivers/${p}/${SHA_A}.json`),
          kind: 'waiver',
          contentType: null,
          cacheSeconds: null,
          fields: Object.freeze({ storyId: 'lion-and-hare', waiverSha256: SHA_A }),
        }),
      ],
      [
        'package',
        (p) => ({
          ...approvalTarget(`packages/${p}/${SHA_A}.json`, 'content'),
          kind: 'package',
          cacheSeconds: 3600,
        }),
      ],
      [
        'media',
        (p) => ({
          kind: 'media',
          bucket: 'content',
          path: `media/lion-and-hare/${SHA_A}-${p}.webp`,
          contentType: 'image/webp',
          cacheSeconds: 3600,
          maxBytes: MEDIA_MAX_BYTES,
          fields: Object.freeze({
            storyId: 'lion-and-hare',
            sha256: SHA_A,
            variant: 'w640',
            mime: 'image/webp',
          }),
        }),
      ],
    ]
    for (const [cls, make] of shapes) {
      for (const [id, form] of PR1_FORMS) {
        const target = make(form as string)
        expect(isSafeStoragePath(target.path), `precondition: ${cls} ${id} is unsafe`).toBe(false)
        expect
          .soft(refusalOf(recheckTarget(target)), `(g1) ${cls} ${id}`)
          .toEqual(refusal(cls, 'class-pattern', 'unsafe-path'))
      }
    }
  })

  it('T13-L9b re-check 1 refuses every safe-but-wrong approval path as class-pattern class-pattern', () => {
    for (const [id, path] of SW_PATHS) {
      expect(isSafeStoragePath(path), `precondition: ${id} is a safe path`).toBe(true)
      expect
        .soft(refusalOf(recheckTarget(approvalTarget(path))), `(g1) ${id}`)
        .toEqual(refusal('approval', 'class-pattern', 'class-pattern'))
    }
  })

  it('T13-L9c re-check 1 compares the bucket and the class pattern, then the fields', () => {
    const rows: [string, Target, string][] = [
      ['waivers path', approvalTarget(`waivers/two-paths/${SHA_A}.json`), 'class-pattern'],
      [
        'bucket content',
        approvalTarget(`approvals/two-paths/${SHA_A}.json`, 'content'),
        'class-pattern',
      ],
      ['other storyId', approvalTarget(`approvals/fox-and-crow/${SHA_A}.json`), 'class-fields'],
      ['other sha', approvalTarget(`approvals/two-paths/${SHA_B}.json`), 'class-fields'],
    ]
    for (const [name, target, rule] of rows) {
      expect(
        classOfPath('masters', target.path),
        `precondition: ${name} matches some class`,
      ).not.toBeNull()
      expect
        .soft(refusalOf(recheckTarget(target)), `(g1) ${name}`)
        .toEqual(refusal('approval', 'class-pattern', rule))
    }
    const pointer = valueOf(pointerTarget('production'))
    const wrong = { ...pointer, path: 'catalogue/staging.json' }
    expect(classOfPath('content', wrong.path), 'precondition: a pointer path').not.toBeNull()
    expect
      .soft(refusalOf(recheckTarget(wrong)), '(g1) pointer fields')
      .toEqual(refusal('pointer', 'class-pattern', 'class-fields'))
    expect
      .soft(recheckTarget(approvalTarget(`approvals/two-paths/${SHA_A}.json`)).ok, '(g0) valid')
      .toBe(true)
  })

  it('T13-L10a re-check 2 refuses every form the URL parser rewrites; re-check 1 refuses the three it keeps', () => {
    for (const origin of [HTTPS_URL, RECORDER_URL]) {
      const valid = `${MASTERS_ROUTE}approvals/two-paths/${SHA_A}.json`
      expect
        .soft(
          recheckUrl(new URL(valid, origin), origin.origin, valid).ok,
          `(g0) valid ${origin.origin}`,
        )
        .toBe(true)
      for (const [id, form] of PR1_FORMS) {
        const route = `${MASTERS_ROUTE}approvals/${form as string}/${SHA_A}.json`
        const url = new URL(route, origin)
        if (UNCHANGED_BY_PARSER.has(id)) {
          expect(url.pathname, `precondition: ${id} unchanged by the parser`).toBe(route)
          expect(
            recheckUrl(url, origin.origin, route).ok,
            `precondition: ${id} passes re-check 2`,
          ).toBe(true)
          expect
            .soft(
              refusalOf(recheckTarget(approvalTarget(`approvals/${form as string}/${SHA_A}.json`))),
              `(g2) ${id} ${origin.origin}`,
            )
            .toEqual(refusal('approval', 'class-pattern', 'unsafe-path'))
        } else {
          expect
            .soft(refusalOf(recheckUrl(url, origin.origin, route)), `(g1) ${id} ${origin.origin}`)
            .toEqual(refusal('ref', 'url', 'url-mismatch'))
        }
      }
    }
  })

  it('T13-L10b re-check 2 compares origin, pathname, search and hash, each alone', () => {
    const route = `${MASTERS_ROUTE}approvals/two-paths/${SHA_A}.json`
    const good = new URL(route, HTTPS_URL)
    const samples: [string, URL, string][] = [
      ['origin', new URL(route, 'https://evil.example'), 'origin'],
      ['pathname', new URL(`${route}x`, HTTPS_URL), 'pathname'],
      ['search', new URL(`${route}?x`, HTTPS_URL), 'search'],
      ['hash', new URL(`${route}#x`, HTTPS_URL), 'hash'],
    ]
    for (const [name, url, field] of samples) {
      const differs = (['origin', 'pathname', 'search', 'hash'] as const).filter(
        (f) => url[f] !== good[f],
      )
      expect(differs, `precondition: ${name} differs in exactly one field`).toEqual([field])
      expect
        .soft(refusalOf(recheckUrl(url, HTTPS_URL.origin, route)), `(g1) ${name}`)
        .toEqual(refusal('ref', 'url', 'url-mismatch'))
    }
  })

  it('T13-L11 storage-layout.ts holds six anchored class-pattern literals and builds no RegExp', () => {
    const text = readFileSync(new URL('./storage-layout.ts', import.meta.url), 'utf8')
    const source = ts.createSourceFile('storage-layout.ts', text, ts.ScriptTarget.Latest, true)
    const literals: string[] = []
    let constructed = 0
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) literals.push(node.getText(source))
      if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'RegExp'
      ) {
        constructed++
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(literals.length, 'precondition: at least 6 regex literals').toBeGreaterThanOrEqual(6)
    expect.soft(constructed, '(g1) no RegExp construction').toBe(0)
    const bodyOf = (literal: string) => literal.slice(1, literal.lastIndexOf('/'))
    const anchored = literals.map(bodyOf).filter((b) => b.startsWith('^') && b.endsWith('$'))
    const heads = [
      '^packages\\/',
      '^media\\/',
      '^catalogue\\/snapshots\\/',
      '^catalogue\\/(',
      '^approvals\\/',
      '^waivers\\/',
    ]
    for (const head of heads) {
      expect
        .soft(
          anchored.some((b) => b.startsWith(head)),
          `(g2) anchored class pattern ${head}`,
        )
        .toBe(true)
    }
    // g3 reads each class's `pattern` where the PATTERNS table holds it, so a class pattern that is a
    // constructed RegExp, a field-rule constant or a field rule's text is found. (Picking the class
    // patterns by their heads, as before, left nothing a field rule could equal: g3 could not fail.)
    const tablePatterns = new Map<string, ts.Expression>()
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'PATTERNS' &&
        node.initializer !== undefined &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const cls of node.initializer.properties) {
          if (ts.isPropertyAssignment(cls) && ts.isObjectLiteralExpression(cls.initializer)) {
            for (const prop of cls.initializer.properties) {
              if (ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'pattern') {
                tablePatterns.set(cls.name.getText(source), prop.initializer)
              }
            }
          }
        }
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    expect(tablePatterns.size, 'precondition: six pattern entries in PATTERNS').toBe(6)
    const fieldBodies = [
      ...literals.map(bodyOf).filter((b) => !heads.some((h) => b.startsWith(h))),
      '^[a-z0-9]+(-[a-z0-9]+)*$',
      '^[a-f0-9]{64}$',
    ]
    for (const [cls, pattern] of tablePatterns) {
      const body = ts.isRegularExpressionLiteral(pattern) ? bodyOf(pattern.getText(source)) : null
      expect
        .soft(
          body !== null && !fieldBodies.includes(body),
          `(g3) the ${cls} pattern is its own literal, not a field rule`,
        )
        .toBe(true)
    }
  })

  it('T13-L12 classOfPath names the class and fields of every built path and nothing else', () => {
    const built: [string, Target][] = [
      ['package', valueOf(targetOf(PACKAGE_REF()))],
      ...MIMES.map((m): [string, Target] => [`media ${m}`, valueOf(targetOf(MEDIA_REF(m)))]),
      ['snapshot', valueOf(targetOf(SNAPSHOT_REF()))],
      ['snapshot max', valueOf(targetOf({ kind: 'snapshot', seq: Number.MAX_SAFE_INTEGER }))],
      ['approval', valueOf(targetOf(APPROVAL_REF()))],
      ['waiver', valueOf(targetOf(WAIVER_REF()))],
      ['production', valueOf(pointerTarget('production'))],
      ['staging', valueOf(pointerTarget('staging'))],
    ]
    for (const [name, target] of built) {
      expect
        .soft(classOfPath(target.bucket, target.path), `(g1) ${name}`)
        .toEqual({ kind: target.kind, fields: { ...target.fields } })
    }
    const masters = [
      '',
      'canary.txt',
      'media-log/x.ndjson',
      'lion-and-hare/images/a.png',
      'lion-and-hare/reports/r.json',
      'approvals/',
      'approvals/two-paths/',
      'waivers/',
      ...SW_PATHS.map(([, p]) => p),
    ]
    for (const path of masters) {
      expect.soft(classOfPath('masters', path), `(g2) masters ${JSON.stringify(path)}`).toBeNull()
    }
    const content = [
      'catalogue/fixtures.json',
      'catalogue/snapshots/0.json',
      'catalogue/snapshots/01.json',
      'catalogue/snapshots/1.5.json',
      'catalogue/snapshots/-1.json',
      'catalogue/snapshots/9007199254740992.json',
      'packages/two-paths.json',
    ]
    for (const path of content) {
      expect.soft(classOfPath('content', path), `(g2) content ${path}`).toBeNull()
    }
    for (const [name, target] of built) {
      const other = target.bucket === 'content' ? 'masters' : 'content'
      expect.soft(classOfPath(other, target.path), `(g2) ${name} in ${other}`).toBeNull()
    }
  })

  it('T13-L13 built paths agree with the build: expectedPackagePath, expectedSnapshotPath and the spec forms', () => {
    const pkg = valueOf(targetOf(PACKAGE_REF())).path
    for (const mode of ['production', 'staging'] as const) {
      expect
        .soft(pkg, `(g1) package ${mode}`)
        .toBe(expectedPackagePath({ storyId: 'two-paths', packageSha256: PKG_SHA }, mode, ''))
    }
    for (const seq of [1, 7, Number.MAX_SAFE_INTEGER]) {
      expect
        .soft(valueOf(targetOf({ kind: 'snapshot', seq })).path, `(g1) snapshot ${seq}`)
        .toBe(expectedSnapshotPath('', seq))
    }
    expect
      .soft(valueOf(targetOf(APPROVAL_REF())).path, '(g1) approval')
      .toBe(`approvals/two-paths/${SHA_A}.json`)
    expect
      .soft(valueOf(targetOf(WAIVER_REF())).path, '(g1) waiver')
      .toBe(`waivers/lion-and-hare/${WAIVER_SHA}.json`)
    for (const mime of MIMES) {
      expect
        .soft(valueOf(targetOf(MEDIA_REF(mime))).path, `(g1) media ${mime}`)
        .toBe(`media/lion-and-hare/${SHA_A}-w640.${MEDIA_EXTENSIONS[mime]}`)
    }
  })

  it('T13-L14 modeFromPointerPath accepts both pointer paths and refuses every other class path', () => {
    for (const mode of ['production', 'staging'] as const) {
      const path = valueOf(pointerTarget(mode)).path
      expect
        .soft(modeFromPointerPath(path), `(g1) ${mode}`)
        .toEqual({ ok: true, value: { mode, root: '' } })
    }
    const others = [
      valueOf(targetOf(PACKAGE_REF())).path,
      valueOf(targetOf(MEDIA_REF())).path,
      valueOf(targetOf(SNAPSHOT_REF())).path,
      valueOf(targetOf(APPROVAL_REF())).path,
      valueOf(targetOf(WAIVER_REF())).path,
      'catalogue/fixtures.json',
    ]
    for (const path of others) {
      expect.soft(modeFromPointerPath(path).ok, `(g2) ${path}`).toBe(false)
    }
  })

  it('T13-L15 planMediaHeads accepts every targetOf media path and refuses a 17-character variant, as targetOf does', () => {
    for (const mime of MIMES) {
      const path = valueOf(targetOf(MEDIA_REF(mime))).path
      const pkg = {
        pkg: { storyId: 'lion-and-hare', assets: [{ variants: [{ path, mime, bytes: 3 }] }] },
      }
      expect
        .soft(planMediaHeads([pkg as unknown as MediaPackage], '').ok, `(g1) ${mime}`)
        .toBe(true)
    }
    const long = 'v'.repeat(17)
    const handBuilt = `media/lion-and-hare/${SHA_A}-${long}.webp`
    const pkg = {
      pkg: {
        storyId: 'lion-and-hare',
        assets: [{ variants: [{ path: handBuilt, mime: 'image/webp', bytes: 3 }] }],
      },
    }
    expect
      .soft(planMediaHeads([pkg as unknown as MediaPackage], '').ok, '(g2) planMediaHeads')
      .toBe(false)
    expect
      .soft(refusalOf(targetOf({ ...MEDIA_REF(), variant: long })), '(g2) targetOf')
      .toEqual(refusal('media', 'field', 'variant'))
  })

  it(
    'T13-L16 10,000 generated refs pass targetOf, both re-checks and the URL parser unchanged',
    { timeout: 60_000 },
    () => {
      const segment = fc.stringMatching(/^[a-z0-9]{1,10}$/)
      const storyId = fc
        .array(segment, { minLength: 1, maxLength: 8 })
        .map((parts) => parts.join('-'))
        .filter((id) => id.length >= 3 && id.length <= 64)
      const sha = fc.stringMatching(/^[a-f0-9]{64}$/)
      const variant = fc.stringMatching(/^[a-z0-9]{1,16}$/)
      const mime = fc.constantFrom(...MIMES)
      const ref = fc.oneof(
        fc.record({ kind: fc.constant('package'), storyId, packageSha256: sha }),
        fc.record({ kind: fc.constant('media'), storyId, sha256: sha, variant, mime }),
        fc.record({
          kind: fc.constant('snapshot'),
          seq: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        }),
        fc.record({ kind: fc.constant('pointer'), mode: fc.constantFrom('production', 'staging') }),
        fc.record({ kind: fc.constant('approval'), storyId, packageSha256: sha }),
        fc.record({ kind: fc.constant('waiver'), storyId, waiverSha256: sha }),
      )
      const counts = new Map<string, number>()
      let longest = ''
      const started = Date.now()
      fc.assert(
        fc.property(ref, (r: Ref) => {
          for (const [key, value] of Object.entries(r)) {
            if (key === 'storyId')
              expect(StoryId.safeParse(value).success, 'precondition: StoryId').toBe(true)
            if (/Sha256$|^sha256$/.test(key))
              expect(Sha256.safeParse(value).success, 'precondition: Sha256').toBe(true)
          }
          counts.set(String(r.kind), (counts.get(String(r.kind)) ?? 0) + 1)
          const result = r.kind === 'pointer' ? pointerTarget(r.mode) : targetOf(r)
          expect(result.ok, `targetOf ${JSON.stringify(r)}`).toBe(true)
          const target = (result as { ok: true; value: Target }).value
          expect(recheckTarget(target).ok, `re-check 1 ${target.path}`).toBe(true)
          expect(isSafeStoragePath(target.path), `isSafeStoragePath ${target.path}`).toBe(true)
          expect(target.path.length, `length ${target.path}`).toBeLessThanOrEqual(157)
          if (target.path.length > longest.length) longest = target.path
          const routes = [`/storage/v1/object/${target.bucket}/${target.path}`]
          if (target.bucket === 'masters')
            routes.push(`/storage/v1/object/authenticated/masters/${target.path}`)
          for (const origin of [HTTPS_URL, RECORDER_URL]) {
            for (const route of routes) {
              const url = new URL(route, origin)
              expect(url.pathname, `pathname ${route}`).toBe(route)
              expect(url.search + url.hash, `search and hash ${route}`).toBe('')
              expect(recheckUrl(url, origin.origin, route).ok, `re-check 2 ${route}`).toBe(true)
            }
          }
        }),
        { seed: 20261121, numRuns: 10_000 },
      )
      console.log(
        `T13-L16 counts ${JSON.stringify(Object.fromEntries(counts))} longest ${longest.length} ms ${Date.now() - started}`,
      )
      for (const kind of ['package', 'media', 'snapshot', 'pointer', 'approval', 'waiver']) {
        expect(
          counts.get(kind) ?? 0,
          `precondition: ${kind} ran at least 1000 times`,
        ).toBeGreaterThanOrEqual(1000)
      }
    },
  )

  it('T13-L17 the longest built paths are typed from the real bounds: media 157 and 156, approval 144, package 143, snapshot 41', () => {
    const id = 'a'.repeat(64)
    const v = 'v'.repeat(16)
    const media = (mime: string) =>
      valueOf(targetOf({ kind: 'media', storyId: id, sha256: SHA_A, variant: v, mime })).path.length
    expect.soft(media('image/webp'), '(g1) webp').toBe(157)
    expect.soft(media('image/jpeg'), '(g1) jpeg').toBe(156)
    expect.soft(media('audio/mpeg'), '(g1) mpeg').toBe(156)
    const approval = valueOf(targetOf({ kind: 'approval', storyId: id, packageSha256: SHA_A })).path
    const pkg = valueOf(targetOf({ kind: 'package', storyId: id, packageSha256: SHA_A })).path
    const snap = valueOf(targetOf({ kind: 'snapshot', seq: Number.MAX_SAFE_INTEGER })).path
    expect.soft(approval.length, '(g1) approval').toBe(144)
    expect.soft(pkg.length, '(g1) package').toBe(143)
    expect.soft(snap.length, '(g1) snapshot').toBe(41)
    for (const p of [approval, pkg, snap])
      expect.soft(p.length <= 512, `(g1) ${p.length} <= 512`).toBe(true)
  })

  it('T13-L18 MAX_JSON_BYTES equals the loader cap and the media cap equals MEDIA_MAX_BYTES and the bucket limit', () => {
    const content = tomlSection(CONFIG_TOML, 'storage.buckets.content')
    expect(content.size, 'precondition: the content section was read').toBeGreaterThan(0)
    expect.soft(MAX_JSON_BYTES, '(g1) MAX_JSON_BYTES = MAX_BODY_BYTES').toBe(MAX_BODY_BYTES)
    expect.soft(MAX_JSON_BYTES, '(g1) MAX_JSON_BYTES = 1 MiB').toBe(1_048_576)
    const media = valueOf(targetOf(MEDIA_REF())).maxBytes
    expect.soft(media, '(g2) media cap = MEDIA_MAX_BYTES').toBe(MEDIA_MAX_BYTES)
    expect
      .soft(media, '(g2) media cap = content file_size_limit')
      .toBe(tomlSize(tomlKey(content, 'file_size_limit')))
  })

  it('T13-L19a every class content type is in its bucket allowed list', () => {
    const content = tomlStrings(
      tomlKey(tomlSection(CONFIG_TOML, 'storage.buckets.content'), 'allowed_mime_types'),
    )
    const masters = tomlStrings(
      tomlKey(tomlSection(CONFIG_TOML, 'storage.buckets.masters'), 'allowed_mime_types'),
    )
    expect(content.length, 'precondition: 4 content types').toBe(4)
    expect(masters.length, 'precondition: 6 masters types').toBe(6)
    const contentTargets = [
      valueOf(targetOf(PACKAGE_REF())),
      ...MIMES.map((m) => valueOf(targetOf(MEDIA_REF(m)))),
      valueOf(targetOf(SNAPSHOT_REF())),
      valueOf(pointerTarget('production')),
    ]
    for (const t of contentTargets) {
      expect
        .soft(content.includes(t.contentType ?? ''), `(g1) ${t.kind} ${t.contentType}`)
        .toBe(true)
    }
    const approval = valueOf(targetOf(APPROVAL_REF()))
    expect.soft(masters.includes(approval.contentType ?? ''), '(g1) approval').toBe(true)
  })

  it('T13-L19b the toml reader skips comments, reads the named section only and knows MiB and KiB', () => {
    const samples: [string, () => unknown, unknown][] = [
      [
        'commented key inside the section',
        () =>
          tomlKey(
            tomlSection(
              '[s.content]\n# allowed_mime_types = ["x/y"]\nallowed_mime_types = ["a/b"]',
              's.content',
            ),
            'allowed_mime_types',
          ),
        '["a/b"]',
      ],
      [
        'commented decoy section first',
        () =>
          tomlKey(
            tomlSection(
              '# [s.content]\n# file_size_limit = "1KiB"\n[s.other]\nfile_size_limit = "2KiB"\n[s.content]\nfile_size_limit = "3KiB"',
              's.content',
            ),
            'file_size_limit',
          ),
        '"3KiB"',
      ],
      [
        'masters before content',
        () =>
          tomlKey(
            tomlSection(
              '[s.masters]\nallowed_mime_types = ["m/m"]\n[s.content]\nallowed_mime_types = ["c/c"]',
              's.content',
            ),
            'allowed_mime_types',
          ),
        '["c/c"]',
      ],
      [
        'spaces and a trailing comment',
        () =>
          tomlKey(
            tomlSection('[s.content]\n  file_size_limit   =   "10MiB"   # note', 's.content'),
            'file_size_limit',
          ),
        '"10MiB"',
      ],
      [
        'missing key throws',
        () => {
          try {
            tomlKey(tomlSection('[s.content]\nx = 1', 's.content'), 'file_size_limit')
            return 'no throw'
          } catch {
            return 'threw'
          }
        },
        'threw',
      ],
      ['10MiB', () => tomlSize('"10MiB"'), 10_485_760],
      ['512KiB', () => tomlSize('"512KiB"'), 524_288],
      [
        'other unit throws',
        () => {
          try {
            tomlSize('"5MB"')
            return 'no throw'
          } catch {
            return 'threw'
          }
        },
        'threw',
      ],
    ]
    expect(samples.length, 'precondition: 8 samples').toBe(8)
    for (const [name, run, want] of samples) {
      let got: unknown
      try {
        got = run()
      } catch (error) {
        got = `threw ${(error as Error).message}`
      }
      expect.soft(got, `(g1) ${name}`).toEqual(want)
    }
  })

  it('T13-L20 a refusal triple never carries the failing value: three fixed tokens only', () => {
    const marker = 'q7marker'
    const samples: [string, { ok: boolean; refusal?: Refusal }][] = [
      ['field story-id', targetOf({ ...APPROVAL_REF(), storyId: `${marker}_x` })],
      ['field kind', targetOf({ ...APPROVAL_REF(), kind: marker })],
      ['field keys', targetOf({ ...APPROVAL_REF(), [marker]: marker })],
      ['field mode', pointerTarget(marker)],
      ['unsafe-path', recheckTarget(approvalTarget(`approvals/${marker} x/${SHA_A}.json`))],
      ['class-pattern', recheckTarget(approvalTarget(`approvals/${marker}_x/${SHA_A}.json`))],
      ['class-fields', recheckTarget(approvalTarget(`approvals/${marker}/${SHA_A}.json`))],
      [
        'url',
        recheckUrl(new URL(`/x/${marker}/../y`, HTTPS_URL), HTTPS_URL.origin, `/x/${marker}/../y`),
      ],
    ]
    for (const [name, result] of samples) {
      expect(result.ok, `precondition: ${name} refuses`).toBe(false)
      const triple = result.refusal!
      expect.soft(JSON.stringify(triple).includes(marker), `(g1) ${name} no marker`).toBe(false)
      expect.soft(Object.keys(triple).sort(), `(g1) ${name} keys`).toEqual(['cls', 'rule', 'stage'])
      expect.soft(triple.cls, `(g1) ${name} cls`).toMatch(/^[a-z]+$/)
      expect.soft(triple.stage, `(g1) ${name} stage`).toMatch(/^[a-z-]+$/)
      expect.soft(triple.rule, `(g1) ${name} rule`).toMatch(/^[a-z0-9-]+$/)
    }
  })
})

// ---- Step 14 (P1-8c): the content read target (design p1-step14-design.md §3.4, §14.10) ----

describe('storage-layout: contentReadTarget (Step 14)', () => {
  it('T14-74 contentReadTarget accepts a pointer mode or a snapshot seq and returns the same Target as pointerTarget or targetOf (A11)', () => {
    const staging = pointerTarget('staging')
    const seven = targetOf({ kind: 'snapshot', seq: 7 })
    expect(staging.ok, 'precondition: pointerTarget(staging) is ok').toBe(true)
    expect(seven.ok, 'precondition: targetOf(snapshot 7) is ok').toBe(true)
    for (const mode of ['production', 'staging'] as const) {
      const want = valueOf(pointerTarget(mode))
      expect
        .soft(contentReadTarget({ kind: 'pointer', mode }), `(g1) ${mode}`)
        .toStrictEqual({ ok: true, value: want })
      const bare = Object.assign(Object.create(null) as Ref, { kind: 'pointer', mode })
      expect
        .soft(contentReadTarget(bare), `(g1) ${mode} with a null prototype`)
        .toStrictEqual({ ok: true, value: want })
    }
    for (const seq of [7, Number.MAX_SAFE_INTEGER]) {
      const want = valueOf(targetOf({ kind: 'snapshot', seq }))
      const got = contentReadTarget({ kind: 'snapshot', seq })
      expect.soft(got, `(g2) snapshot ${seq}`).toStrictEqual({ ok: true, value: want })
      expect
        .soft(got.ok && Object.isFrozen(got.value.fields), `(g2) ${seq} fields frozen`)
        .toBe(true)
      expect.soft(got.ok && recheckTarget(got.value).ok, `(g2) ${seq} passes re-check 1`).toBe(true)
    }
  })

  it('T14-75 contentReadTarget refuses every other ref at stage field and reads the ref once (A11, CRIT-10)', () => {
    const positives: [string, Ref][] = [
      ['pointer staging', { kind: 'pointer', mode: 'staging' }],
      ['snapshot 7', { kind: 'snapshot', seq: 7 }],
    ]
    for (const [name, ref] of positives) {
      expect(contentReadTarget(ref).ok, `precondition: ${name} passes`).toBe(true)
    }
    // (g1) the kinds
    const kinds: [string, unknown, ReturnType<typeof refusal>][] = [
      ['package', PACKAGE_REF(), refusal('package', 'field', 'kind-not-content-readable')],
      ['media', MEDIA_REF(), refusal('media', 'field', 'kind-not-content-readable')],
      ['approval', APPROVAL_REF(), refusal('approval', 'field', 'kind-not-content-readable')],
      ['waiver', WAIVER_REF(), refusal('waiver', 'field', 'kind-not-content-readable')],
      ['kind x', { kind: 'x', mode: 'staging' }, refusal('ref', 'field', 'kind-unknown')],
      ['no kind', { mode: 'staging' }, refusal('ref', 'field', 'kind-unknown')],
    ]
    for (const [name, ref, want] of kinds) {
      let outcome: unknown
      try {
        outcome = refusalOf(contentReadTarget(ref))
      } catch (error) {
        outcome = `threw ${error instanceof Error ? error.name : typeof error}`
      }
      expect.soft(outcome, `(g1) ${name}`).toEqual(want)
    }
    // (g2) the shapes
    const shapes: [string, unknown, ReturnType<typeof refusal>][] = [
      [
        'extra key',
        { kind: 'pointer', mode: 'staging', x: 1 },
        refusal('pointer', 'field', 'ref-keys'),
      ],
      ['no mode', { kind: 'pointer' }, refusal('pointer', 'field', 'ref-keys')],
      ['no seq', { kind: 'snapshot' }, refusal('snapshot', 'field', 'ref-keys')],
      [
        'symbol key',
        { kind: 'pointer', mode: 'staging', [Symbol('x')]: 1 },
        refusal('pointer', 'field', 'ref-keys'),
      ],
      [
        'Object.create({})',
        Object.assign(Object.create({}) as Ref, { kind: 'pointer', mode: 'staging' }),
        refusal('ref', 'field', 'ref-prototype'),
      ],
      ['[]', [], refusal('ref', 'field', 'ref-not-object')],
      ['null', null, refusal('ref', 'field', 'ref-not-object')],
      ["'pointer'", 'pointer', refusal('ref', 'field', 'ref-not-object')],
    ]
    const hiddenExtra: Ref = { kind: 'pointer', mode: 'staging' }
    Object.defineProperty(hiddenExtra, 'path', { value: 'x', enumerable: false })
    shapes.push(['non-enumerable key', hiddenExtra, refusal('pointer', 'field', 'ref-keys')])
    const hiddenSeq: Ref = { kind: 'snapshot' }
    Object.defineProperty(hiddenSeq, 'seq', { value: 7, enumerable: false })
    shapes.push(['non-enumerable seq', hiddenSeq, refusal('snapshot', 'field', 'ref-keys')])
    let getterRuns = 0
    const getterMode: Ref = { kind: 'pointer' }
    Object.defineProperty(getterMode, 'mode', {
      get: () => (getterRuns++, 'staging'),
      enumerable: true,
    })
    shapes.push(['accessor mode', getterMode, refusal('pointer', 'field', 'ref-accessor')])
    const getterKind: Ref = { mode: 'staging' }
    Object.defineProperty(getterKind, 'kind', { get: () => 'pointer', enumerable: true })
    shapes.push(['accessor kind', getterKind, refusal('ref', 'field', 'ref-accessor')])
    for (const [name, ref, want] of shapes) {
      expect.soft(refusalOf(contentReadTarget(ref)), `(g2) ${name}`).toEqual(want)
    }
    expect.soft(getterRuns, '(g2) the mode getter ran 0 times').toBe(0)
    // (g3) the field values
    const modes: [string, unknown][] = [
      ['fixtures', 'fixtures'],
      ['Production', 'Production'],
      ["' staging'", ' staging'],
      ["new String('staging')", new String('staging')],
    ]
    for (const [name, mode] of modes) {
      expect
        .soft(refusalOf(contentReadTarget({ kind: 'pointer', mode })), `(g3) mode ${name}`)
        .toEqual(refusal('pointer', 'field', 'mode'))
    }
    const seqs: [string, unknown][] = [
      ['0', 0],
      ['-1', -1],
      ['1.5', 1.5],
      ["'7'", '7'],
      ['2**53', 2 ** 53],
      ['-0', -0],
      ['NaN', NaN],
      ['Infinity', Infinity],
    ]
    for (const [name, seq] of seqs) {
      expect
        .soft(refusalOf(contentReadTarget({ kind: 'snapshot', seq })), `(g3) seq ${name}`)
        .toEqual(refusal('snapshot', 'field', 'seq'))
    }
    // (g4) a Proxy whose ownKeys answer differs per call: one ownKeys call, no get trap
    const proxyOf = (base: Ref, second: (string | symbol)[]) => {
      const counts = { ownKeys: 0, get: 0 }
      const proxy = new Proxy(base, {
        ownKeys(target) {
          counts.ownKeys++
          return counts.ownKeys === 1 ? Reflect.ownKeys(target) : second
        },
        get(target, key, receiver) {
          counts.get++
          return key === 'mode' ? 'production' : Reflect.get(target, key, receiver)
        },
      })
      return { proxy, counts }
    }
    const pointerProxy = proxyOf({ kind: 'pointer', mode: 'staging' }, ['kind'])
    const pointerResult = contentReadTarget(pointerProxy.proxy)
    expect(
      pointerProxy.counts.ownKeys,
      'precondition: the pointer ownKeys trap ran',
    ).toBeGreaterThan(0)
    expect
      .soft(
        pointerResult.ok && pointerResult.value.path,
        '(g4) pointer built from the first answer',
      )
      .toBe('catalogue/staging.json')
    expect.soft(pointerProxy.counts.ownKeys, '(g4) pointer ownKeys called once').toBe(1)
    expect.soft(pointerProxy.counts.get, '(g4) pointer get trap never called').toBe(0)
    const snapshotProxy = proxyOf({ kind: 'snapshot', seq: 7 }, ['kind', 'seq', 'extra'])
    const snapshotResult = contentReadTarget(snapshotProxy.proxy)
    expect(
      snapshotProxy.counts.ownKeys,
      'precondition: the snapshot ownKeys trap ran',
    ).toBeGreaterThan(0)
    expect
      .soft(
        snapshotResult.ok && snapshotResult.value.path,
        '(g4) snapshot built from the first answer',
      )
      .toBe('catalogue/snapshots/7.json')
    expect.soft(snapshotProxy.counts.ownKeys, '(g4) snapshot ownKeys called once').toBe(1)
    expect.soft(snapshotProxy.counts.get, '(g4) snapshot get trap never called').toBe(0)
  })
})
