// The per-story local checks shared by validate and stage (design
// migration-input/p1-step14-design.md §4.2, D14-2 to D14-6, D14-22, D14-26, §9 L1, L7, L13; P1-8c,
// Step 14). No network: files are read through local-files.ts. In order, the first failure of a
// story is its blocking code and later stories still run: 1. the package file; 2. canonical JCS,
// strict parse, storyId, collection; 3. phase 1 refused; 4. the waiver file (D14-3) with the R24
// refusal (D14-4); 5. the validator in publish mode with the shared matcher (D14-2); 6. the build's
// checkPackage on the exact bytes and entry stage writes; 7. planMediaHeads once per story, then
// each variant's bytes (A002/A003). A result carries codes and counts; never a finding message, a
// zod issue, a parse or derive message, a planMediaHeads or checkPackage reason, or a waiver
// file's private fields. Full validator findings are kept for report.ts, which reduces each to
// {checkId, severity, nodeId, locale, waived}.
import { z } from 'zod'
import {
  decodeJson,
  expectedPackagePath,
  isCanonicalJcs,
  parseStrictJson,
} from '../../src/core/content/gates'
import { MEDIA_MAX_BYTES, planMediaHeads, type MediaMime } from '../../src/core/content/media'
import { checkPackage, type SnapshotEntry } from '../../src/core/content/packages'
import { sha256Hex } from '../../src/core/hashing'
import { WaiverKeys, type WaiverKey } from '../../src/core/package/catalogue'
import { StoryPackageV1, hasOwnProtoKey } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import type { PrivateRuleData } from '../../src/core/rules/types'
import type { Finding } from '../../src/core/validator/types'
import { validatePackage } from '../../src/core/validator/validate'
import { WaiverFile, applyWaiverKeys, deriveWaiverKeys } from '../../src/core/validator/waivers'
import { readLocalFile, type LocalFileCode } from './local-files'
import { checkVariantBytes, type MediaCode } from './media-check'
import { MAX_JSON_BYTES } from './storage-layout'

const RULESET = PANCHATANTRA_RULESET

/**
 * R24 (D14-4): a record with `nodeId: null` passes only on these checks, which read only the graph
 * the fingerprint binds, and only with `locale: null` (the validator emits them with no locale).
 */
export const GRAPH_BOUND_CHECKS: ReadonlySet<string> = new Set([
  'G001',
  'G002',
  'G007',
  'G008',
  'E001',
  'E002',
  'E003',
  'E007',
])

export type WaiverCode =
  | 'waiver-file-invalid'
  | 'waiver-story-id'
  | 'waiver-rule-set'
  | 'waiver-story-level-key'
  | 'waiver-keys-invalid'

export type LocalCode =
  | LocalFileCode
  | WaiverCode
  | MediaCode
  | 'package-not-jcs'
  | 'package-strict-parse'
  | 'package-story-id'
  | 'package-collection'
  | 'phase-1-package'
  | 'waiver-file-missing'
  | 'waiver-on-non-migration'
  | 'validator-unwaived'
  | 'package-gate'
  | 'media-plan'

export interface StoryCounts {
  /** Unwaived errors, lapsed ones included. */
  readonly errors: number
  readonly waived: number
  readonly lapsed: number
  readonly warnings: number
  readonly info: number
  readonly unusedKeys: number
}

export interface LocalVerdict {
  /** True when any unwaived error remains (D14-2); A001, X000 and S001 are never waived. */
  readonly blocking: boolean
  /** The validator's findings with the keys applied (waived ones marked). */
  readonly findings: readonly Finding[]
  /** Check ids that did not run (E016-E018 without the private word lists). */
  readonly skipped: readonly string[]
  readonly unusedKeys: readonly WaiverKey[]
  readonly counts: StoryCounts
}

export interface LocalWaiver {
  /** The sha256 of the raw local bytes: the masters object's name (D14-3). */
  readonly sha256: string
  readonly block: WaiverKeys
}

export interface LocalMedia {
  readonly path: string
  readonly mime: MediaMime
  readonly bytes: number
  readonly sha256: string
  readonly state: 'checked' | 'refused'
}

export interface LocalStory {
  readonly storyId: string
  readonly blocking: LocalCode | null
  /** Set only for waiver-story-level-key: story, check and locale (D14-4). */
  readonly message: string | null
  readonly packageBytes: Uint8Array<ArrayBuffer> | null
  readonly packageSha256: string | null
  readonly pkg: StoryPackageV1 | null
  readonly waiver: LocalWaiver | null
  readonly verdict: LocalVerdict | null
  /** The snapshot entry stage writes (no approvalSha256, the staging packagePath, the block). */
  readonly entry: SnapshotEntry | null
  /** Each variant read, in declaration order, up to the first refusal. */
  readonly media: readonly LocalMedia[]
}

export interface StoryCheckInputs {
  readonly packagesDir: string
  readonly mediaDir: string
  readonly waiversDir: string
  readonly privateData: PrivateRuleData | null
}

/** The private word file, re-declared strictly (validate-cli.ts is never imported; D14-26). */
const PrivateFile = z.strictObject({
  ref: z.string(),
  idioms: z.array(z.string()),
  anachronismKeywords: z.array(z.string()),
  sanskritNeverCall: z.record(z.string(), z.array(z.string())),
})

export type PrivateLists =
  | {
      readonly ok: true
      readonly data: PrivateRuleData | null
      readonly state: 'loaded' | 'not loaded'
    }
  | { readonly ok: false; readonly code: 'private-lists-invalid' }

/**
 * `<storyboardRoot>/.rules-private/<ref>.private.json`, read once per run (D14-26): absent means
 * not loaded (E016-E018 skipped); present but not a regular file, not JSON, holding an own
 * `__proto__` key, not strict-valid or naming another ref is `private-lists-invalid`.
 */
export function loadPrivateLists(storyboardRoot: string): PrivateLists {
  const invalid: PrivateLists = { ok: false, code: 'private-lists-invalid' }
  const read = readLocalFile(
    storyboardRoot,
    ['.rules-private', `${RULESET.ref}.private.json`],
    MAX_JSON_BYTES,
  )
  if (!read.ok) {
    return read.code === 'local-file-missing'
      ? { ok: true, data: null, state: 'not loaded' }
      : invalid
  }
  const decoded = decodeJson(read.bytes, 'private word lists')
  if (!decoded.ok || hasOwnProtoKey(decoded.value)) return invalid
  const parsed = PrivateFile.safeParse(decoded.value)
  if (!parsed.success || parsed.data.ref !== RULESET.ref) return invalid
  return { ok: true, data: parsed.data, state: 'loaded' }
}

export type WaiverBlock =
  | { readonly ok: true; readonly waiver: LocalWaiver }
  | { readonly ok: false; readonly code: WaiverCode; readonly message: string | null }

const storyLevelMessage = (storyId: string, checkId: string, locale: string | null): string =>
  `waiver-story-level-key story=${storyId} check=${/^[A-Z][0-9]{3}$/.test(checkId) ? checkId : 'invalid'} locale=${locale ?? 'none'}`

/**
 * The waiver block from a waiver file's raw bytes (D14-3, D14-4), for the local copy and, at stage,
 * the masters copy: sha256 of the raw bytes; UTF-8 JSON with no own `__proto__` key at any depth,
 * then the strict WaiverFile; storyId and ruleSetRef; R24; deriveWaiverKeys; the WaiverKeys re-parse.
 * A failure is its code alone (and for R24 the fixed story, check and locale message).
 */
export async function deriveWaiverBlock(
  storyId: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<WaiverBlock> {
  const fail = (code: WaiverCode, message: string | null = null): WaiverBlock => ({
    ok: false,
    code,
    message,
  })
  const sha256 = await sha256Hex(bytes)
  const decoded = decodeJson(bytes, 'waiver file')
  if (!decoded.ok || hasOwnProtoKey(decoded.value)) return fail('waiver-file-invalid')
  const parsed = WaiverFile.safeParse(decoded.value)
  if (!parsed.success) return fail('waiver-file-invalid')
  const file = parsed.data
  if (file.storyId !== storyId) return fail('waiver-story-id')
  if (file.ruleSetRef !== RULESET.ref) return fail('waiver-rule-set')
  for (const record of file.waivers) {
    if (record.nodeId !== null) continue
    if (GRAPH_BOUND_CHECKS.has(record.checkId) && record.locale === null) continue
    return fail('waiver-story-level-key', storyLevelMessage(storyId, record.checkId, record.locale))
  }
  let derived: WaiverKeys
  try {
    derived = deriveWaiverKeys(file, sha256)
  } catch {
    return fail('waiver-keys-invalid')
  }
  const block = WaiverKeys.safeParse(derived)
  if (!block.success) return fail('waiver-keys-invalid')
  return { ok: true, waiver: { sha256, block: block.data } }
}

/**
 * Step 5 (D14-2): the validator in publish mode (private word lists when given), then the shared
 * matcher with the block's keys. Blocking is any unwaived error, lapsed ones included.
 */
export async function validatorVerdict(
  pkg: StoryPackageV1,
  block: WaiverKeys | null,
  privateData: PrivateRuleData | null,
): Promise<LocalVerdict> {
  const report = validatePackage(pkg, {
    ruleSet: RULESET,
    mode: 'publish',
    ...(privateData ? { privateData } : {}),
  })
  const applied = await applyWaiverKeys(report, pkg, block?.keys ?? [])
  const findings = applied.report.findings
  const unwaived = findings.filter((f) => f.severity === 'error' && f.waived !== true)
  const count = (severity: Finding['severity']) =>
    findings.filter((f) => f.severity === severity).length
  return {
    blocking: unwaived.length > 0,
    findings,
    skipped: applied.report.skipped.map((s) => s.checkId),
    unusedKeys: applied.unused,
    counts: {
      errors: unwaived.length,
      waived: findings.filter((f) => f.waived === true).length,
      lapsed: applied.lapsed.length,
      warnings: count('warn'),
      info: count('info'),
      unusedKeys: applied.unused.length,
    },
  }
}

/** The local checks of one story (§4.2). Never throws for a bad input file. */
export async function checkStory(storyId: string, inputs: StoryCheckInputs): Promise<LocalStory> {
  let state: LocalStory = {
    storyId,
    blocking: null,
    message: null,
    packageBytes: null,
    packageSha256: null,
    pkg: null,
    waiver: null,
    verdict: null,
    entry: null,
    media: [],
  }
  const blocked = (blocking: LocalCode, message: string | null = null): LocalStory => ({
    ...state,
    blocking,
    message,
  })

  const read = readLocalFile(inputs.packagesDir, [`${storyId}.json`], MAX_JSON_BYTES)
  if (!read.ok) return blocked(read.code)
  const bytes = read.bytes
  state = { ...state, packageBytes: bytes, packageSha256: await sha256Hex(bytes) }

  const decoded = decodeJson(bytes, 'package')
  if (!decoded.ok || !isCanonicalJcs(decoded.value, bytes)) return blocked('package-not-jcs')
  const parsed = parseStrictJson(bytes, StoryPackageV1, 'package')
  if (!parsed.ok) return blocked('package-strict-parse')
  const pkg = parsed.value.data
  state = { ...state, pkg }
  if (pkg.storyId !== storyId) return blocked('package-story-id')
  if (pkg.collectionId !== RULESET.collectionId) return blocked('package-collection')
  if (pkg.assets.length === 0) return blocked('phase-1-package')

  const waiverRead = readLocalFile(inputs.waiversDir, [`${storyId}.json`], MAX_JSON_BYTES)
  if (pkg.origin === 'migration') {
    if (!waiverRead.ok) {
      return blocked(
        waiverRead.code === 'local-file-missing' ? 'waiver-file-missing' : waiverRead.code,
      )
    }
    const derived = await deriveWaiverBlock(storyId, waiverRead.bytes)
    if (!derived.ok) return blocked(derived.code, derived.message)
    state = { ...state, waiver: derived.waiver }
  } else if (waiverRead.ok) {
    return blocked('waiver-on-non-migration')
  } else if (waiverRead.code !== 'local-file-missing') {
    return blocked(waiverRead.code)
  }

  const block = state.waiver?.block ?? null
  const verdict = await validatorVerdict(pkg, block, inputs.privateData)
  state = { ...state, verdict }
  if (verdict.blocking) return blocked('validator-unwaived')

  const packageSha256 = state.packageSha256 ?? ''
  const entry: SnapshotEntry = {
    storyId: pkg.storyId,
    collectionId: pkg.collectionId,
    version: pkg.version,
    packagePath: expectedPackagePath({ storyId: pkg.storyId, packageSha256 }, 'staging', ''),
    packageSha256,
    ...(block ? { waivers: block } : {}),
  }
  const gate = await checkPackage(bytes, entry, RULESET, { requireJcs: true })
  if (!gate.ok) return blocked('package-gate')
  state = { ...state, entry }

  if (!planMediaHeads([{ pkg }], '').ok) return blocked('media-plan')
  const media: LocalMedia[] = []
  for (const asset of pkg.assets) {
    for (const variant of asset.variants) {
      const file = readLocalFile(inputs.mediaDir, variant.path.split('/'), MEDIA_MAX_BYTES)
      if (!file.ok) return { ...blocked(file.code), media }
      const { path, mime, bytes: size } = variant
      const checked = await checkVariantBytes(
        { assetId: asset.id, path, mime, bytes: size },
        file.bytes,
      )
      media.push({
        path,
        mime,
        bytes: size,
        sha256: checked.sha256,
        state: checked.ok ? 'checked' : 'refused',
      })
      if (!checked.ok) return { ...blocked(checked.code), media }
    }
  }
  return { ...state, media }
}

/** The local checks of every story, in the given order; a blocked story never stops the rest. */
export async function checkStories(
  storyIds: readonly string[],
  inputs: StoryCheckInputs,
): Promise<LocalStory[]> {
  const results: LocalStory[] = []
  for (const storyId of storyIds) results.push(await checkStory(storyId, inputs))
  return results
}
