// Progress records on the device (spec §6.3; P1-4a, owner answers 2026-11-14). Pure: no storage,
// window, timers or I/O. The browser side (src/reader/progress) moves the raw text in and out of
// localStorage; what the text means, how it is checked and how it changes lives here.
// - Two keys, each a strict object with schema 1. Any change to either record bumps schema.
// - Reading never throws and never writes. Invalid data resets the smallest part: an unreadable
//   key reads as empty; otherwise per story and per field, and a story entry is dropped only when
//   its version or order is invalid. The cleaned record is saved by the next real save.
// - A stored schema that is a whole number above 1 (after a rollback) is reported as
//   'newer-schema': the caller leaves the bytes untouched and keeps that record in memory for the
//   page visit. Any other schema value is damage and resets.
// - No timestamps, names, free text or identifiers: `order` is a per-device counter, not a time.
import { z } from 'zod'
import type { LocaleCode } from '../locales'
import { Locale, NodeId, StoryId, hasOwnProtoKey } from '../package/v1'

export const PROGRESS_KEY = 'reader.v1.progress'
export const PREFS_KEY = 'reader.v1.prefs'
export const RECORD_KEYS = [PROGRESS_KEY, PREFS_KEY] as const
export type RecordKey = (typeof RECORD_KEYS)[number]

export const RECORD_SCHEMA = 1

/** A saved run holds 1-64 node ids (owner, 2026-11-14; a package has at most 64 nodes). */
export const MAX_RUN_PATH = 64
/** endingsFound holds at most 64 unique ids (owner, 2026-11-14). */
export const MAX_ENDINGS_FOUND = 64
/** The package format ceiling on nodes (src/core/package/v1.ts), so on a story's endings too. */
const MAX_PACKAGE_NODES = 64

/** uiLocale values: the enabled reader locales; null = not chosen yet (owner, 2026-11-14). */
export const UI_LOCALES = ['en', 'hi'] as const satisfies readonly LocaleCode[]
export type UiLocale = (typeof UI_LOCALES)[number]

/** Text size in percent (spec §6.1 Settings: 100/125/150%). */
export const TEXT_SCALES = [100, 125, 150] as const
export type TextScale = (typeof TEXT_SCALES)[number]

export interface ActiveRun {
  readonly path: readonly string[]
  readonly locale: LocaleCode
}

export interface StoryProgress {
  /** The package version stamped by the last save; resume ignores it (spec §6.2). */
  readonly version: number
  /** Null at an ending and at the start node: a saved run means a choice made and not finished. */
  readonly activeRun: ActiveRun | null
  /** Unique ending node ids in the order found. Ids that are no longer endings are kept. */
  readonly endingsFound: readonly string[]
  /** Per-device counter for "Continue reading": the highest order is the most recent story. */
  readonly order: number
}

export type StoryProgressMap = Readonly<Record<string, StoryProgress>>

export interface ProgressRecord {
  readonly schema: typeof RECORD_SCHEMA
  readonly stories: StoryProgressMap
}

export interface ProgressEntry extends StoryProgress {
  readonly storyId: string
}

export interface Prefs {
  readonly uiLocale: UiLocale | null
  readonly textScale: TextScale
  readonly readToMe: boolean
}

export interface PrefsRecord extends Prefs {
  readonly schema: typeof RECORD_SCHEMA
}

/** What one accepted engine step saves: the run and a found ending together (spec §6.3). */
export interface StepWrite {
  /** The current package version, stamped on the story by every save. */
  readonly version: number
  readonly activeRun: ActiveRun | null
  /** The ending this step reached, or null. */
  readonly ending: string | null
  /** The current story's ending ids: ids outside it are evicted first at the endingsFound cap. */
  readonly currentEndings: readonly string[]
}

export const DEFAULT_PREFS: Prefs = Object.freeze({
  uiLocale: null,
  textScale: 100,
  readToMe: false,
})

export const EMPTY_PROGRESS: ProgressRecord = Object.freeze({
  schema: RECORD_SCHEMA,
  stories: Object.freeze({}),
})

const DEFAULT_PREFS_RECORD: PrefsRecord = Object.freeze({ schema: RECORD_SCHEMA, ...DEFAULT_PREFS })

// ---------------------------------------------------------------------------------------------
// Schemas. Objects are strict: an unknown key is invalid (owner, 2026-11-14).

const Version = z.number().int().min(1)
// int() also keeps it within Number.MAX_SAFE_INTEGER.
const Order = z.number().int().min(1)
const RunPath = z.array(NodeId).min(1).max(MAX_RUN_PATH)

export const ActiveRunSchema = z.strictObject({ path: RunPath, locale: Locale })

const EndingsFound = z
  .array(NodeId)
  .max(MAX_ENDINGS_FOUND)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'endingsFound must be unique' })

export const StoryProgressSchema = z.strictObject({
  version: Version,
  activeRun: ActiveRunSchema.nullable(),
  endingsFound: EndingsFound,
  order: Order,
})

export const ProgressRecordSchema = z.strictObject({
  schema: z.literal(RECORD_SCHEMA),
  stories: z.record(StoryId, StoryProgressSchema),
})

const UiLocaleValue = z.enum(UI_LOCALES).nullable()
const TextScaleValue = z.literal(TEXT_SCALES)
const ReadToMeValue = z.boolean()

export const PrefsRecordSchema = z.strictObject({
  schema: z.literal(RECORD_SCHEMA),
  uiLocale: UiLocaleValue,
  textScale: TextScaleValue,
  readToMe: ReadToMeValue,
})

/** A prefs update: any subset of the three fields, nothing else. */
export const PrefsPatchSchema = PrefsRecordSchema.omit({ schema: true }).partial()
export type PrefsPatch = z.infer<typeof PrefsPatchSchema>

export const StepWriteSchema = z
  .strictObject({
    version: Version,
    activeRun: ActiveRunSchema.nullable(),
    ending: NodeId.nullable(),
    currentEndings: z.array(NodeId).max(MAX_PACKAGE_NODES),
  })
  .refine((w) => w.ending === null || w.currentEndings.includes(w.ending), {
    message: 'ending must be one of currentEndings',
  })

// ---------------------------------------------------------------------------------------------
// Reading. Never throws; reports every part it reset.

export type ReadIssueCode =
  /** The text is not JSON: the key reads as empty. */
  | 'unreadable'
  /** An own "__proto__" key anywhere: the key reads as empty. */
  | 'proto-key'
  /** Not an object, schema not 1, or (progress) no stories object: the key reads as empty. */
  | 'top-level'
  /** A key the record does not define: that key is dropped, the rest is kept. */
  | 'unknown-key'
  /** An invalid story id, or an invalid version or order: that story entry is dropped. */
  | 'story-dropped'
  /** A bad run: it becomes null; the story's endings and order stay. */
  | 'run-reset'
  /** endingsFound not a list, or invalid ids in it: those ids are dropped. */
  | 'endings-invalid'
  /** The same id more than once: merged into one. */
  | 'endings-duplicate'
  /** More than 64 ids: the first 64 are kept. */
  | 'endings-over-cap'
  /** A prefs field missing or invalid: back to its default. */
  | 'field-reset'

export interface ReadIssue {
  readonly code: ReadIssueCode
  /** Where, as a dotted path ("" for the whole key). Stays on the device; never sent anywhere. */
  readonly at: string
}

export type RecordRead<T> =
  | { readonly kind: 'record'; readonly record: T; readonly issues: readonly ReadIssue[] }
  /** schema above 1: leave the stored bytes untouched and use memory for this record. */
  | { readonly kind: 'newer-schema'; readonly schema: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(raw: string): { readonly ok: true; readonly value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * The stored schema when it is a safe integer above 1 (rollback protection), else null. A newer
 * build only ever writes a whole schema number, so 1.5, 1e999 or 2^60 is damage, not a newer
 * record: it resets like any other bad top level and the next save replaces it (owner, 2026-11-14).
 */
export function newerSchemaOf(value: unknown): number | null {
  if (!isPlainObject(value) || !Object.hasOwn(value, 'schema')) return null
  const schema = value['schema']
  return typeof schema === 'number' && Number.isSafeInteger(schema) && schema > RECORD_SCHEMA
    ? schema
    : null
}

function clean<T>(record: T): RecordRead<T> {
  return { kind: 'record', record, issues: [] }
}

function emptied<T>(record: T, code: ReadIssueCode): RecordRead<T> {
  return { kind: 'record', record, issues: [{ code, at: '' }] }
}

/**
 * The checks every key shares, in order: unreadable JSON, then rollback protection (so newer bytes
 * are never judged by this version's rules), then "__proto__" keys, then the top-level shape.
 */
function readTopLevel<T>(
  raw: string,
  empty: T,
):
  | { readonly done: RecordRead<T> }
  | { readonly done: null; readonly value: Record<string, unknown> } {
  const parsed = parseJson(raw)
  if (!parsed.ok) return { done: emptied(empty, 'unreadable') }
  const newer = newerSchemaOf(parsed.value)
  if (newer !== null) return { done: { kind: 'newer-schema', schema: newer } }
  // Zod records skip "__proto__" keys silently; such a key is never written by this code.
  if (hasOwnProtoKey(parsed.value)) return { done: emptied(empty, 'proto-key') }
  const value = parsed.value
  if (!isPlainObject(value) || value['schema'] !== RECORD_SCHEMA) {
    return { done: emptied(empty, 'top-level') }
  }
  return { done: null, value }
}

function noteUnknownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  at: string,
  issues: ReadIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue
    issues.push({ code: 'unknown-key', at: at === '' ? key : `${at}.${key}` })
  }
}

const PROGRESS_FIELDS = ['schema', 'stories'] as const
const STORY_KEYS = ['version', 'activeRun', 'endingsFound', 'order'] as const
const RUN_KEYS = ['path', 'locale'] as const
const PREFS_FIELDS = ['schema', 'uiLocale', 'textScale', 'readToMe'] as const

function salvageRun(value: unknown, at: string, issues: ReadIssue[]): ActiveRun | null {
  if (value === null) return null
  // Missing, not an object, a bad path (0 or over 64 ids, an invalid id) or an unregistered
  // locale: only the run becomes null (owner, 2026-11-14).
  if (!isPlainObject(value)) {
    issues.push({ code: 'run-reset', at })
    return null
  }
  const path = RunPath.safeParse(value['path'])
  const locale = Locale.safeParse(value['locale'])
  if (!path.success || !locale.success) {
    issues.push({ code: 'run-reset', at })
    return null
  }
  noteUnknownKeys(value, RUN_KEYS, at, issues)
  return { path: path.data, locale: locale.data }
}

function salvageEndings(value: unknown, at: string, issues: ReadIssue[]): string[] {
  if (!Array.isArray(value)) {
    issues.push({ code: 'endings-invalid', at })
    return []
  }
  const valid = value.filter((id): id is string => NodeId.safeParse(id).success)
  if (valid.length !== value.length) issues.push({ code: 'endings-invalid', at })
  const unique = [...new Set(valid)]
  if (unique.length !== valid.length) issues.push({ code: 'endings-duplicate', at })
  if (unique.length > MAX_ENDINGS_FOUND) {
    issues.push({ code: 'endings-over-cap', at })
    return unique.slice(0, MAX_ENDINGS_FOUND)
  }
  return unique
}

function salvageStory(storyId: string, value: unknown, issues: ReadIssue[]): StoryProgress | null {
  const at = `stories.${storyId}`
  if (!StoryId.safeParse(storyId).success || !isPlainObject(value)) {
    issues.push({ code: 'story-dropped', at })
    return null
  }
  const version = Version.safeParse(value['version'])
  const order = Order.safeParse(value['order'])
  if (!version.success || !order.success) {
    issues.push({ code: 'story-dropped', at })
    return null
  }
  noteUnknownKeys(value, STORY_KEYS, at, issues)
  return {
    version: version.data,
    activeRun: salvageRun(value['activeRun'], `${at}.activeRun`, issues),
    endingsFound: salvageEndings(value['endingsFound'], `${at}.endingsFound`, issues),
    order: order.data,
  }
}

/** Reads reader.v1.progress. null (no key) is an empty record with no issues. */
export function readProgress(raw: string | null): RecordRead<ProgressRecord> {
  if (raw === null) return clean(EMPTY_PROGRESS)
  const top = readTopLevel(raw, EMPTY_PROGRESS)
  if (top.done !== null) return top.done
  const stories = top.value['stories']
  if (!isPlainObject(stories)) return emptied(EMPTY_PROGRESS, 'top-level')

  const strict = ProgressRecordSchema.safeParse(top.value)
  if (strict.success) return clean(strict.data)

  const issues: ReadIssue[] = []
  noteUnknownKeys(top.value, PROGRESS_FIELDS, '', issues)
  const kept: [string, StoryProgress][] = []
  for (const [storyId, value] of Object.entries(stories)) {
    const story = salvageStory(storyId, value, issues)
    if (story !== null) kept.push([storyId, story])
  }
  return {
    kind: 'record',
    record: { schema: RECORD_SCHEMA, stories: Object.fromEntries(kept) },
    issues,
  }
}

/** Reads reader.v1.prefs. null (no key) is the defaults with no issues. Fields reset one by one. */
export function readPrefs(raw: string | null): RecordRead<PrefsRecord> {
  if (raw === null) return clean(DEFAULT_PREFS_RECORD)
  const top = readTopLevel(raw, DEFAULT_PREFS_RECORD)
  if (top.done !== null) return top.done

  const strict = PrefsRecordSchema.safeParse(top.value)
  if (strict.success) return clean(strict.data)

  const value = top.value
  const issues: ReadIssue[] = []
  noteUnknownKeys(value, PREFS_FIELDS, '', issues)
  function field<T>(name: keyof Prefs, schema: z.ZodType<T>, fallback: T): T {
    const result = schema.safeParse(value[name])
    if (result.success) return result.data
    issues.push({ code: 'field-reset', at: name })
    return fallback
  }
  const record: PrefsRecord = {
    schema: RECORD_SCHEMA,
    uiLocale: field('uiLocale', UiLocaleValue, DEFAULT_PREFS.uiLocale),
    textScale: field('textScale', TextScaleValue, DEFAULT_PREFS.textScale),
    readToMe: field('readToMe', ReadToMeValue, DEFAULT_PREFS.readToMe),
  }
  return { kind: 'record', record, issues }
}

// ---------------------------------------------------------------------------------------------
// Writing. Callers pass records that came from a read or from the updates below.

export function serializeProgress(record: ProgressRecord): string {
  // Fixed key order; fromEntries defines own properties for every story id.
  const stories = Object.fromEntries(
    Object.entries(record.stories).map(([storyId, s]) => [
      storyId,
      {
        version: s.version,
        activeRun:
          s.activeRun === null ? null : { path: s.activeRun.path, locale: s.activeRun.locale },
        endingsFound: s.endingsFound,
        order: s.order,
      },
    ]),
  )
  return JSON.stringify({ schema: RECORD_SCHEMA, stories })
}

export function serializePrefs(prefs: Prefs): string {
  return JSON.stringify({
    schema: RECORD_SCHEMA,
    uiLocale: prefs.uiLocale,
    textScale: prefs.textScale,
    readToMe: prefs.readToMe,
  })
}

export function prefsOf(record: PrefsRecord): Prefs {
  return { uiLocale: record.uiLocale, textScale: record.textScale, readToMe: record.readToMe }
}

// ---------------------------------------------------------------------------------------------
// Pure updates.

/** The story's entry, or null. Own keys only: a story id such as "constructor" is safe. */
export function storyProgressOf(record: ProgressRecord, storyId: string): StoryProgress | null {
  return Object.hasOwn(record.stories, storyId) ? (record.stories[storyId] ?? null) : null
}

/** "Continue reading" order: highest order first, then storyId (code-unit order). */
export function byRecency(a: ProgressEntry, b: ProgressEntry): number {
  if (a.order !== b.order) return b.order - a.order
  if (a.storyId === b.storyId) return 0
  return a.storyId < b.storyId ? -1 : 1
}

export function listProgress(record: ProgressRecord): ProgressEntry[] {
  return Object.entries(record.stories)
    .map(([storyId, s]) => ({ storyId, ...s }))
    .sort(byRecency)
}

/** Orders 1..n, keeping the list order exactly (ties broken as byRecency breaks them). */
export function renumberOrders(stories: StoryProgressMap): StoryProgressMap {
  const listed = Object.entries(stories)
    .map(([storyId, s]) => ({ storyId, ...s }))
    .sort(byRecency)
  return Object.fromEntries(
    listed.map(({ storyId, ...s }, index) => [storyId, { ...s, order: listed.length - index }]),
  )
}

/**
 * Gives the story the highest order + 1, unless it already holds the highest order alone
 * (a tie is broken in its favour). When the next order would pass Number.MAX_SAFE_INTEGER, every
 * story is first renumbered 1..n in the same order (owner, 2026-11-14).
 */
export function bumpOrder(stories: StoryProgressMap, storyId: string): StoryProgressMap {
  if (!Object.hasOwn(stories, storyId)) return stories
  const highestOther = (map: StoryProgressMap): number => {
    let highest = 0
    for (const [id, s] of Object.entries(map)) {
      if (id !== storyId && s.order > highest) highest = s.order
    }
    return highest
  }
  const self = stories[storyId]
  let base = stories
  let highest = highestOther(base)
  if (self !== undefined && self.order > highest) return stories
  if (highest >= Number.MAX_SAFE_INTEGER) {
    base = renumberOrders(stories)
    highest = highestOther(base)
  }
  const entry = base[storyId]
  if (entry === undefined) return stories
  return { ...base, [storyId]: { ...entry, order: highest + 1 } }
}

/**
 * Adds a found ending. At the cap, ids that are not endings in the current story are evicted
 * first, oldest first, and only as many as needed (owner, 2026-11-14). A package has at most 64
 * nodes, so when all 64 stored ids are current endings a new id cannot be another current ending:
 * evicting the oldest current id is a fallback valid packages never reach; it only keeps the cap.
 */
export function addEnding(
  found: readonly string[],
  ending: string | null,
  currentEndings: readonly string[],
): readonly string[] {
  if (ending === null || found.includes(ending)) return found
  const next = [...found]
  let excess = next.length + 1 - MAX_ENDINGS_FOUND
  if (excess > 0) {
    const current = new Set(currentEndings)
    for (let i = 0; i < next.length && excess > 0;) {
      if (current.has(next[i] ?? '')) {
        i++
      } else {
        next.splice(i, 1)
        excess--
      }
    }
    if (excess > 0) next.splice(0, excess)
  }
  next.push(ending)
  return next
}

/**
 * One accepted step's save, applied to a freshly read record (spec §6.3): this story gets the
 * step's run (the latest run wins), its endings joined with the found one, the current version
 * and the highest order. Other stories stay exactly as read.
 */
export function applyStepSave(
  record: ProgressRecord,
  storyId: string,
  write: StepWrite,
): ProgressRecord {
  const previous = storyProgressOf(record, storyId)
  const entry: StoryProgress = {
    version: write.version,
    activeRun:
      write.activeRun === null
        ? null
        : { path: [...write.activeRun.path], locale: write.activeRun.locale },
    endingsFound: addEnding(previous?.endingsFound ?? [], write.ending, write.currentEndings),
    // 0 is a placeholder for a new story; bumpOrder always replaces it.
    order: previous?.order ?? 0,
  }
  return {
    schema: RECORD_SCHEMA,
    stories: bumpOrder({ ...record.stories, [storyId]: entry }, storyId),
  }
}

/** "Start again": the run becomes null, endings, version and order stay. Same record if no change. */
export function resetRunOf(record: ProgressRecord, storyId: string): ProgressRecord {
  const story = storyProgressOf(record, storyId)
  if (story === null || story.activeRun === null) return record
  return {
    schema: RECORD_SCHEMA,
    stories: { ...record.stories, [storyId]: { ...story, activeRun: null } },
  }
}

/** Removes one story. Same record if it is not there. */
export function removeStory(record: ProgressRecord, storyId: string): ProgressRecord {
  if (storyProgressOf(record, storyId) === null) return record
  return {
    schema: RECORD_SCHEMA,
    stories: Object.fromEntries(Object.entries(record.stories).filter(([id]) => id !== storyId)),
  }
}
