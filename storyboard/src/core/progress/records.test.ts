import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ENABLED_LOCALE_CODES } from '../locales'
import {
  DEFAULT_PREFS,
  EMPTY_PROGRESS,
  MAX_ENDINGS_FOUND,
  MAX_RUN_PATH,
  PREFS_KEY,
  PROGRESS_KEY,
  PrefsPatchSchema,
  PrefsRecordSchema,
  ProgressRecordSchema,
  StepWriteSchema,
  addEnding,
  applyStepSave,
  bumpOrder,
  listProgress,
  newerSchemaOf,
  readPrefs,
  readProgress,
  removeStory,
  renumberOrders,
  resetRunOf,
  serializePrefs,
  serializeProgress,
  storyProgressOf,
  type ProgressRecord,
  type ReadIssueCode,
  type RecordRead,
  type StepWrite,
  type StoryProgress,
} from './records'

const SEED = 20261114

const entry = (overrides: Partial<StoryProgress> = {}): StoryProgress => ({
  version: 1,
  activeRun: { path: ['start', 'wise_path'], locale: 'en' },
  endingsFound: ['ending_quick'],
  order: 1,
  ...overrides,
})

const record = (stories: Record<string, StoryProgress>): ProgressRecord => ({ schema: 1, stories })

/** The stored text for a progress value, with one story's fields replaced. */
function rawWithStory(fields: Record<string, unknown>, storyId = 'two-paths'): string {
  return JSON.stringify({ schema: 1, stories: { [storyId]: { ...entry(), ...fields } } })
}

function recordOf<T>(read: RecordRead<T>): T {
  if (read.kind !== 'record') throw new Error(`expected a record, got ${read.kind}`)
  return read.record
}

function codesOf<T>(read: RecordRead<T>): ReadIssueCode[] {
  return read.kind === 'record' ? read.issues.map((i) => i.code) : []
}

const write = (overrides: Partial<StepWrite> = {}): StepWrite => ({
  version: 2,
  activeRun: { path: ['start', 'quick_path'], locale: 'hi' },
  ending: null,
  currentEndings: ['ending_wise', 'ending_quick'],
  ...overrides,
})

describe('record keys and values (spec §6.3)', () => {
  it('uses the two spec keys', () => {
    expect(PROGRESS_KEY).toBe('reader.v1.progress')
    expect(PREFS_KEY).toBe('reader.v1.prefs')
  })

  it('offers exactly the enabled locales as uiLocale values (a change would bump schema)', () => {
    expect(PrefsRecordSchema.shape.uiLocale.unwrap().options).toEqual([...ENABLED_LOCALE_CODES])
  })

  it('has the owner defaults: uiLocale not chosen, text 100%, Read to me off', () => {
    expect(DEFAULT_PREFS).toEqual({ uiLocale: null, textScale: 100, readToMe: false })
    expect(Object.isFrozen(DEFAULT_PREFS)).toBe(true)
    expect(Object.isFrozen(EMPTY_PROGRESS)).toBe(true)
  })

  it('makes every object strict: an unknown key is invalid', () => {
    const ok = { schema: 1, stories: { 'two-paths': entry() } }
    expect(ProgressRecordSchema.safeParse(ok).success).toBe(true)
    expect(ProgressRecordSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    const withStoryKey = { schema: 1, stories: { 'two-paths': { ...entry(), at: 1 } } }
    expect(ProgressRecordSchema.safeParse(withStoryKey).success).toBe(false)
    const run = { path: ['start'], locale: 'en', node: 'x' }
    const withRunKey = { schema: 1, stories: { 'two-paths': { ...entry(), activeRun: run } } }
    expect(ProgressRecordSchema.safeParse(withRunKey).success).toBe(false)
    const prefs = { schema: 1, ...DEFAULT_PREFS }
    expect(PrefsRecordSchema.safeParse(prefs).success).toBe(true)
    expect(PrefsRecordSchema.safeParse({ ...prefs, theme: 'dark' }).success).toBe(false)
    expect(PrefsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false)
    expect(StepWriteSchema.safeParse({ ...write(), at: 1 }).success).toBe(false)
  })

  it('refuses a step write whose ending is not one of the current endings', () => {
    expect(StepWriteSchema.safeParse(write({ ending: 'ending_wise' })).success).toBe(true)
    expect(StepWriteSchema.safeParse(write({ ending: 'start' })).success).toBe(false)
  })
})

describe('readProgress: valid records', () => {
  it('reads a missing key as an empty record with no issues', () => {
    expect(readProgress(null)).toEqual({ kind: 'record', record: EMPTY_PROGRESS, issues: [] })
  })

  it('reads a valid record unchanged, with no issues', () => {
    const value = record({ 'two-paths': entry(), 'lion-and-hare': entry({ activeRun: null }) })
    const read = readProgress(JSON.stringify(value))
    expect(read).toEqual({ kind: 'record', record: value, issues: [] })
  })

  it('accepts run paths of 1 and 64 ids and every registered run locale', () => {
    const path64 = Array.from({ length: MAX_RUN_PATH }, (_, i) => `n${i}`)
    for (const path of [['wise_path'], path64]) {
      expect(codesOf(readProgress(rawWithStory({ activeRun: { path, locale: 'en' } })))).toEqual([])
    }
    for (const locale of ['en', 'hi', 'ar']) {
      const read = readProgress(rawWithStory({ activeRun: { path: ['start', 'x'], locale } }))
      expect(codesOf(read)).toEqual([])
    }
  })

  it('keeps a run in every registered locale on the salvage path too', () => {
    for (const locale of ['en', 'hi', 'ar']) {
      // The unknown top-level key sends the read through the salvage path, not the strict parse.
      const raw = JSON.stringify({
        schema: 1,
        extra: 1,
        stories: { 'two-paths': { ...entry(), activeRun: { path: ['start', 'x'], locale } } },
      })
      const read = readProgress(raw)
      expect(codesOf(read)).toEqual(['unknown-key'])
      expect(storyProgressOf(recordOf(read), 'two-paths')?.activeRun).toEqual({
        path: ['start', 'x'],
        locale,
      })
    }
  })

  it('accepts 64 unique endings and orders up to Number.MAX_SAFE_INTEGER', () => {
    const endings = Array.from({ length: MAX_ENDINGS_FOUND }, (_, i) => `e${i}`)
    const read = readProgress(
      rawWithStory({ endingsFound: endings, order: Number.MAX_SAFE_INTEGER }),
    )
    expect(codesOf(read)).toEqual([])
  })

  it('keeps a story id that is also an Object.prototype name', () => {
    const read = readProgress(rawWithStory({}, 'constructor'))
    expect(codesOf(read)).toEqual([])
    expect(storyProgressOf(recordOf(read), 'constructor')).toEqual(entry())
    expect(storyProgressOf(EMPTY_PROGRESS, 'constructor')).toBeNull()
    expect(storyProgressOf(EMPTY_PROGRESS, 'toString')).toBeNull()
  })
})

describe('readProgress: the whole key reads as empty', () => {
  const empties: [string, string, ReadIssueCode][] = [
    ['unreadable JSON', '{"schema":1,', 'unreadable'],
    ['an empty string', '', 'unreadable'],
    ['a top-level "__proto__" key', '{"schema":1,"stories":{},"__proto__":{}}', 'proto-key'],
    [
      'a "__proto__" story',
      '{"schema":1,"stories":{"__proto__":{"version":1,"activeRun":null,"endingsFound":[],"order":1}}}',
      'proto-key',
    ],
    [
      'a "__proto__" key inside a run',
      rawWithStory({ activeRun: JSON.parse('{"__proto__":1}') }),
      'proto-key',
    ],
    ['JSON null', 'null', 'top-level'],
    ['an array', '[]', 'top-level'],
    ['a number', '1', 'top-level'],
    ['a string', '"x"', 'top-level'],
    ['no schema', '{"stories":{}}', 'top-level'],
    ['schema 0', '{"schema":0,"stories":{}}', 'top-level'],
    ['schema "1"', '{"schema":"1","stories":{}}', 'top-level'],
    ['schema 1 with no stories', '{"schema":1}', 'top-level'],
    ['stories as a list', '{"schema":1,"stories":[]}', 'top-level'],
    ['stories as null', '{"schema":1,"stories":null}', 'top-level'],
  ]
  it.each(empties)('%s', (_name, raw, code) => {
    expect(readProgress(raw)).toEqual({
      kind: 'record',
      record: EMPTY_PROGRESS,
      issues: [{ code, at: '' }],
    })
  })

  it('finds a "__proto__" key even when JSON.parse made it an own property', () => {
    const raw = rawWithStory({ endingsFound: ['a'] }).replace(
      '"order"',
      '"__proto__":{"x":1},"order"',
    )
    expect(codesOf(readProgress(raw))).toEqual(['proto-key'])
  })
})

describe('readProgress: the smallest part resets', () => {
  it('a bad run becomes null; the endings, version and order stay', () => {
    const bad: unknown[] = [
      { path: [], locale: 'en' },
      { path: Array.from({ length: MAX_RUN_PATH + 1 }, (_, i) => `n${i}`), locale: 'en' },
      { path: ['start', 'Not An Id'], locale: 'en' },
      { path: ['start', 7], locale: 'en' },
      { path: 'start', locale: 'en' },
      { path: ['start', 'x'], locale: 'fr' },
      { path: ['start', 'x'] },
      'start',
      [],
      7,
    ]
    for (const activeRun of bad) {
      const read = readProgress(
        rawWithStory({ activeRun, endingsFound: ['ending_wise'], order: 4 }),
      )
      expect(codesOf(read)).toEqual(['run-reset'])
      expect(storyProgressOf(recordOf(read), 'two-paths')).toEqual(
        entry({ activeRun: null, endingsFound: ['ending_wise'], order: 4 }),
      )
    }
  })

  it('a missing run resets to null', () => {
    const raw = JSON.stringify({
      schema: 1,
      stories: { a1b: { version: 1, endingsFound: [], order: 1 } },
    })
    const read = readProgress(raw)
    expect(read.kind === 'record' && read.issues).toEqual([
      { code: 'run-reset', at: 'stories.a1b.activeRun' },
    ])
    expect(storyProgressOf(recordOf(read), 'a1b')?.activeRun).toBeNull()
  })

  it('merges duplicate endings, keeping the first of each', () => {
    const read = readProgress(rawWithStory({ endingsFound: ['b', 'a', 'b', 'a', 'c'] }))
    expect(codesOf(read)).toEqual(['endings-duplicate'])
    expect(storyProgressOf(recordOf(read), 'two-paths')?.endingsFound).toEqual(['b', 'a', 'c'])
  })

  it('drops invalid ending ids and keeps the valid ones', () => {
    const read = readProgress(rawWithStory({ endingsFound: ['ok_end', 'Bad', 3, null, ''] }))
    expect(codesOf(read)).toEqual(['endings-invalid'])
    expect(storyProgressOf(recordOf(read), 'two-paths')?.endingsFound).toEqual(['ok_end'])
  })

  it('reads endingsFound that is not a list as no endings', () => {
    for (const endingsFound of [null, 'ending_wise', { a: 1 }, undefined]) {
      const read = readProgress(rawWithStory({ endingsFound }))
      expect(codesOf(read)).toEqual(['endings-invalid'])
      expect(storyProgressOf(recordOf(read), 'two-paths')?.endingsFound).toEqual([])
    }
  })

  it('keeps the first 64 of more than 64 unique endings', () => {
    const ids = Array.from({ length: 70 }, (_, i) => `e${i}`)
    const read = readProgress(rawWithStory({ endingsFound: ids }))
    expect(codesOf(read)).toEqual(['endings-over-cap'])
    expect(storyProgressOf(recordOf(read), 'two-paths')?.endingsFound).toEqual(ids.slice(0, 64))
  })

  it('drops a story entry only for an invalid version or order', () => {
    const badNumbers: unknown[] = [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2]
    for (const version of [...badNumbers, undefined]) {
      const raw = JSON.stringify({
        schema: 1,
        stories: { 'two-paths': { ...entry(), version }, 'lion-and-hare': entry() },
      })
      const read = readProgress(raw)
      expect(codesOf(read)).toEqual(['story-dropped'])
      expect(recordOf(read).stories).toEqual({ 'lion-and-hare': entry() })
    }
    for (const order of [...badNumbers, undefined]) {
      const read = readProgress(rawWithStory({ order }))
      expect(codesOf(read)).toEqual(['story-dropped'])
      expect(recordOf(read)).toEqual(EMPTY_PROGRESS)
    }
  })

  it('drops an entry that is not an object, or whose story id is invalid', () => {
    const raw = JSON.stringify({
      schema: 1,
      stories: { 'two-paths': 'x', 'Bad Id': entry(), ab: entry(), 'lion-and-hare': entry() },
    })
    const read = readProgress(raw)
    expect(read.kind === 'record' && read.issues).toEqual([
      { code: 'story-dropped', at: 'stories.two-paths' },
      { code: 'story-dropped', at: 'stories.Bad Id' },
      { code: 'story-dropped', at: 'stories.ab' },
    ])
    expect(Object.keys(recordOf(read).stories)).toEqual(['lion-and-hare'])
  })

  it('drops unknown keys alone, at every level, and keeps the rest', () => {
    const raw = JSON.stringify({
      schema: 1,
      stories: {
        'two-paths': {
          ...entry(),
          activeRun: { path: ['start', 'wise_path'], locale: 'en', at: 5 },
          note: 'x',
        },
      },
      extra: true,
    })
    const read = readProgress(raw)
    expect(read.kind === 'record' && read.issues).toEqual([
      { code: 'unknown-key', at: 'extra' },
      { code: 'unknown-key', at: 'stories.two-paths.note' },
      { code: 'unknown-key', at: 'stories.two-paths.activeRun.at' },
    ])
    expect(recordOf(read)).toEqual(record({ 'two-paths': entry() }))
  })

  it('reports several parts of one story together', () => {
    const read = readProgress(rawWithStory({ activeRun: 1, endingsFound: ['a', 'a', 'B'] }))
    expect(codesOf(read)).toEqual(['run-reset', 'endings-invalid', 'endings-duplicate'])
  })
})

describe('schema protection (rollback)', () => {
  it('reports any whole schema above 1 as newer, whatever else the record holds', () => {
    for (const raw of [
      '{"schema":2,"stories":{}}',
      '{"schema":2}',
      '{"schema":2,"stories":[],"other":{"__proto__":1}}',
      `{"schema":${Number.MAX_SAFE_INTEGER}}`,
    ]) {
      expect(readProgress(raw).kind).toBe('newer-schema')
      expect(readPrefs(raw).kind).toBe('newer-schema')
    }
    expect(readProgress('{"schema":7}')).toEqual({ kind: 'newer-schema', schema: 7 })
  })

  it('resets a schema that no build writes (not a safe whole number) instead of protecting it', () => {
    for (const raw of [
      '{"schema":1.5,"stories":{}}',
      '{"schema":1e999}',
      `{"schema":${2 ** 60},"stories":{}}`,
    ]) {
      expect(readProgress(raw)).toEqual({
        kind: 'record',
        record: EMPTY_PROGRESS,
        issues: [{ code: 'top-level', at: '' }],
      })
      const prefs = readPrefs(raw)
      expect(prefs.kind).toBe('record')
      expect(prefs.kind === 'record' ? prefs.issues : null).toEqual([{ code: 'top-level', at: '' }])
    }
  })

  it('treats only an own safe whole schema above 1 as newer', () => {
    expect(newerSchemaOf({ schema: 1 })).toBeNull()
    expect(newerSchemaOf({ schema: '2' })).toBeNull()
    expect(newerSchemaOf({ schema: 1.5 })).toBeNull()
    expect(newerSchemaOf({ schema: Infinity })).toBeNull()
    expect(newerSchemaOf({ schema: Number.MAX_SAFE_INTEGER + 1 })).toBeNull()
    expect(newerSchemaOf([2])).toBeNull()
    expect(newerSchemaOf(null)).toBeNull()
    expect(newerSchemaOf(Object.create({ schema: 2 }) as unknown)).toBeNull()
    expect(newerSchemaOf({ schema: 3 })).toBe(3)
  })
})

describe('readPrefs', () => {
  const prefsRaw = (fields: Record<string, unknown>) =>
    JSON.stringify({ schema: 1, ...DEFAULT_PREFS, ...fields })

  it('reads a missing key as the defaults with no issues', () => {
    expect(readPrefs(null)).toEqual({
      kind: 'record',
      record: { schema: 1, ...DEFAULT_PREFS },
      issues: [],
    })
  })

  it('reads every valid value', () => {
    for (const uiLocale of ['en', 'hi', null]) {
      for (const textScale of [100, 125, 150]) {
        for (const readToMe of [true, false]) {
          const read = readPrefs(prefsRaw({ uiLocale, textScale, readToMe }))
          expect(read).toEqual({
            kind: 'record',
            record: { schema: 1, uiLocale, textScale, readToMe },
            issues: [],
          })
        }
      }
    }
  })

  it('resets fields one by one', () => {
    const read = readPrefs(prefsRaw({ uiLocale: 'ar', textScale: 150, readToMe: 'yes' }))
    expect(read.kind === 'record' && read.issues).toEqual([
      { code: 'field-reset', at: 'uiLocale' },
      { code: 'field-reset', at: 'readToMe' },
    ])
    expect(recordOf(read)).toEqual({ schema: 1, uiLocale: null, textScale: 150, readToMe: false })
    for (const textScale of [120, '125', null, 100.5]) {
      const one = readPrefs(prefsRaw({ uiLocale: 'hi', textScale }))
      expect(recordOf(one)).toEqual({ schema: 1, uiLocale: 'hi', textScale: 100, readToMe: false })
    }
  })

  it('resets a missing field to its default and drops unknown keys', () => {
    const read = readPrefs('{"schema":1,"textScale":125,"theme":"dark"}')
    expect(read.kind === 'record' && read.issues).toEqual([
      { code: 'unknown-key', at: 'theme' },
      { code: 'field-reset', at: 'uiLocale' },
      { code: 'field-reset', at: 'readToMe' },
    ])
    expect(recordOf(read)).toEqual({ schema: 1, uiLocale: null, textScale: 125, readToMe: false })
  })

  it('reads unreadable JSON, "__proto__" and a wrong top level as the defaults', () => {
    const defaults = { schema: 1, ...DEFAULT_PREFS }
    expect(readPrefs('{')).toEqual({
      kind: 'record',
      record: defaults,
      issues: [{ code: 'unreadable', at: '' }],
    })
    expect(codesOf(readPrefs('{"schema":1,"__proto__":{"readToMe":true}}'))).toEqual(['proto-key'])
    for (const raw of ['[]', '{"textScale":125}', '{"schema":0}', 'true']) {
      expect(readPrefs(raw)).toEqual({
        kind: 'record',
        record: defaults,
        issues: [{ code: 'top-level', at: '' }],
      })
    }
  })
})

describe('serialize', () => {
  it('writes the progress record with a fixed key order', () => {
    const value = record({ 'two-paths': entry() })
    expect(serializeProgress(value)).toBe(
      '{"schema":1,"stories":{"two-paths":{"version":1,"activeRun":{"path":["start","wise_path"],"locale":"en"},"endingsFound":["ending_quick"],"order":1}}}',
    )
    expect(recordOf(readProgress(serializeProgress(value)))).toEqual(value)
  })

  it('writes prefs with a fixed key order', () => {
    expect(serializePrefs({ readToMe: true, textScale: 125, uiLocale: 'hi' })).toBe(
      '{"schema":1,"uiLocale":"hi","textScale":125,"readToMe":true}',
    )
  })
})

describe('order: the most recent story holds the highest order', () => {
  it('gives a new story the highest order + 1', () => {
    const stories = { a1a: entry({ order: 3 }), b2b: entry({ order: 7 }), new: entry({ order: 0 }) }
    expect(bumpOrder(stories, 'new').new?.order).toBe(8)
  })

  it('leaves a story that already holds the highest order alone', () => {
    const stories = { a1a: entry({ order: 3 }), b2b: entry({ order: 7 }) }
    expect(bumpOrder(stories, 'b2b')).toBe(stories)
    expect(bumpOrder(stories, 'a1a').a1a?.order).toBe(8)
  })

  it('breaks a tie at the top in favour of the story being saved', () => {
    const stories = { a1a: entry({ order: 7 }), b2b: entry({ order: 7 }) }
    expect(bumpOrder(stories, 'b2b').b2b?.order).toBe(8)
    expect(bumpOrder(stories, 'a1a').a1a?.order).toBe(8)
  })

  it('renumbers 1..n in the same order before passing Number.MAX_SAFE_INTEGER', () => {
    const max = Number.MAX_SAFE_INTEGER
    const stories = {
      top: entry({ order: max }),
      mid: entry({ order: max - 1 }),
      low: entry({ order: 5 }),
      tie: entry({ order: 5 }),
    }
    const bumped = bumpOrder(stories, 'low')
    expect(Object.fromEntries(Object.entries(bumped).map(([id, s]) => [id, s.order]))).toEqual({
      top: 4,
      mid: 3,
      tie: 1,
      low: 5,
    })
    expect(listProgress(record(bumped)).map((e) => e.storyId)).toEqual(['low', 'top', 'mid', 'tie'])
    // The story at the very top needs no renumbering.
    expect(bumpOrder(stories, 'top')).toBe(stories)
  })

  it('renumbers ties in list order (storyId breaks a tie)', () => {
    const renumbered = renumberOrders({
      zed: entry({ order: 9 }),
      abc: entry({ order: 9 }),
      mid: entry({ order: 2 }),
    })
    expect(renumbered).toEqual({
      abc: entry({ order: 3 }),
      zed: entry({ order: 2 }),
      mid: entry({ order: 1 }),
    })
  })

  it('lists the highest order first, then by storyId', () => {
    const value = record({
      zed: entry({ order: 2 }),
      abc: entry({ order: 2 }),
      top: entry({ order: 9 }),
      low: entry({ order: 1 }),
    })
    expect(listProgress(value).map((e) => [e.storyId, e.order])).toEqual([
      ['top', 9],
      ['abc', 2],
      ['zed', 2],
      ['low', 1],
    ])
  })
})

describe('endingsFound: unique, at most 64, stale ids evicted first', () => {
  const current = ['ending_wise', 'ending_quick']

  it('appends a new ending and ignores one already found', () => {
    expect(addEnding(['ending_quick'], 'ending_wise', current)).toEqual([
      'ending_quick',
      'ending_wise',
    ])
    const found = ['ending_quick']
    expect(addEnding(found, 'ending_quick', current)).toBe(found)
    expect(addEnding(found, null, current)).toBe(found)
  })

  it('keeps ids that are no longer endings while there is room', () => {
    expect(addEnding(['old_end'], 'ending_wise', current)).toEqual(['old_end', 'ending_wise'])
  })

  it('evicts the oldest stale id, and only one, when adding would pass 64', () => {
    const stale = Array.from({ length: 40 }, (_, i) => `old_${i}`)
    const fresh = Array.from({ length: 24 }, (_, i) => `new_${i}`)
    const currentEndings = Array.from({ length: 30 }, (_, i) => `new_${i}`)
    const next = addEnding(
      [...fresh.slice(0, 12), ...stale, ...fresh.slice(12)],
      'new_24',
      currentEndings,
    )
    expect(next).toHaveLength(MAX_ENDINGS_FOUND)
    expect(next).not.toContain('old_0')
    expect(next).toContain('old_1')
    expect(next.filter((id) => id.startsWith('new_'))).toHaveLength(25)
    expect(next[next.length - 1]).toBe('new_24')
  })

  it('records the 65th (and later) unique id across versions without passing the cap', () => {
    // 64 ids found over several versions; version 3 has endings v3_0..v3_9, of which 5 are found.
    const found = [
      ...Array.from({ length: 59 }, (_, i) => `v1_${i}`),
      ...Array.from({ length: 5 }, (_, i) => `v3_${i}`),
    ]
    const currentEndings = Array.from({ length: 10 }, (_, i) => `v3_${i}`)
    let endings: readonly string[] = found
    for (let i = 5; i < 10; i++) endings = addEnding(endings, `v3_${i}`, currentEndings)
    expect(endings).toHaveLength(64)
    expect(new Set(endings).size).toBe(64)
    expect(endings.filter((id) => id.startsWith('v3_'))).toEqual(currentEndings)
    expect(endings.slice(0, 54)).toEqual(found.slice(5, 59))
  })

  it('falls back to the oldest id when every stored id is current (unreachable for valid packages)', () => {
    const all = Array.from({ length: 65 }, (_, i) => `e${i}`)
    const next = addEnding(all.slice(0, 64), 'e64', all)
    expect(next).toEqual(all.slice(1))
  })
})

describe('pure updates', () => {
  it('a step save stamps the version, takes the run, joins the ending and bumps the order', () => {
    const before = record({
      'two-paths': entry({ endingsFound: ['ending_quick'], order: 2, version: 1 }),
      other: entry({ order: 5 }),
    })
    const after = applyStepSave(
      before,
      'two-paths',
      write({ activeRun: null, ending: 'ending_wise' }),
    )
    expect(after.stories['two-paths']).toEqual({
      version: 2,
      activeRun: null,
      endingsFound: ['ending_quick', 'ending_wise'],
      order: 6,
    })
    expect(after.stories.other).toBe(before.stories.other)
    expect(before.stories['two-paths']?.version).toBe(1)
  })

  it('a step save creates the entry when the story has none', () => {
    const after = applyStepSave(EMPTY_PROGRESS, 'two-paths', write())
    expect(after).toEqual(
      record({
        'two-paths': {
          version: 2,
          activeRun: { path: ['start', 'quick_path'], locale: 'hi' },
          endingsFound: [],
          order: 1,
        },
      }),
    )
    expect(ProgressRecordSchema.safeParse(after).success).toBe(true)
  })

  it('resetRun nulls the run and keeps endings, version and order', () => {
    const before = record({ 'two-paths': entry({ order: 4, version: 3 }) })
    expect(resetRunOf(before, 'two-paths').stories['two-paths']).toEqual(
      entry({ order: 4, version: 3, activeRun: null }),
    )
    const noRun = record({ 'two-paths': entry({ activeRun: null }) })
    expect(resetRunOf(noRun, 'two-paths')).toBe(noRun)
    expect(resetRunOf(before, 'missing')).toBe(before)
  })

  it('removeStory removes one story and nothing else', () => {
    const before = record({ 'two-paths': entry(), other: entry({ order: 2 }) })
    expect(removeStory(before, 'two-paths')).toEqual(record({ other: entry({ order: 2 }) }))
    expect(removeStory(before, 'missing')).toBe(before)
  })
})

describe('reading properties (fixed seed)', () => {
  const arbNodeId = fc.oneof(
    fc.constantFrom('start', 'wise_path', 'ending_wise', 'ending_quick'),
    fc.integer({ min: 0, max: 90 }).map((n) => `e${n}`),
    fc.string({ maxLength: 4 }),
    fc.integer(),
  )
  const arbEndingId = fc.integer({ min: 0, max: 200 }).map((n) => `e${n}`)
  // Long lists come from their own arbitraries, so the 64-id caps are crossed in both directions.
  const arbLongIds = fc.uniqueArray(arbEndingId, { minLength: 60, maxLength: 70 })
  const arbRun = fc.oneof(
    fc.constant(null),
    fc.record(
      {
        path: fc.oneof(fc.array(arbNodeId, { maxLength: 8 }), arbLongIds, fc.anything()),
        locale: fc.constantFrom('en', 'hi', 'ar', 'xx', 3, null),
        extra: fc.anything(),
      },
      { requiredKeys: ['path', 'locale'] },
    ),
    fc.anything(),
  )
  const arbNumber = fc.oneof(
    fc.integer({ min: -3, max: 12 }),
    fc.constantFrom(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 2, 0.5),
    fc.string({ maxLength: 2 }),
  )
  const arbEntry = fc.oneof(
    fc.record(
      {
        version: arbNumber,
        activeRun: arbRun,
        endingsFound: fc.oneof(fc.array(arbNodeId, { maxLength: 10 }), arbLongIds, fc.anything()),
        order: arbNumber,
        extra: fc.anything(),
      },
      { requiredKeys: [] },
    ),
    fc.anything(),
  )
  const arbStoryId = fc.oneof(
    fc.constantFrom('two-paths', 'lion-and-hare', 'constructor', 'ab', 'Bad Id'),
    fc.string({ maxLength: 6 }),
  )
  const arbProgress = fc.record(
    {
      schema: fc.constantFrom(1, 1, 1, 1, 0, '1', 2),
      stories: fc.oneof(fc.dictionary(arbStoryId, arbEntry, { maxKeys: 8 }), fc.anything()),
      extra: fc.anything(),
    },
    { requiredKeys: ['schema'] },
  )
  const arbBytes = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 200 }),
    fc.uint8Array({ maxLength: 200 }).map((bytes) => String.fromCharCode(...bytes)),
    fc.jsonValue().map((v) => JSON.stringify(v)),
  )

  function checkProgress(raw: string): void {
    const read = readProgress(raw)
    if (read.kind === 'newer-schema') return
    // Whatever was stored, the result is a valid record, and it reads back clean and unchanged.
    expect(ProgressRecordSchema.safeParse(read.record).success).toBe(true)
    const again = readProgress(serializeProgress(read.record))
    expect(again).toEqual({ kind: 'record', record: read.record, issues: [] })
  }

  function checkPrefs(raw: string): void {
    const read = readPrefs(raw)
    if (read.kind === 'newer-schema') return
    expect(PrefsRecordSchema.safeParse(read.record).success).toBe(true)
    expect(readPrefs(serializePrefs(read.record))).toEqual({
      kind: 'record',
      record: read.record,
      issues: [],
    })
  }

  it('random byte strings never throw and always read as a valid record', () => {
    fc.assert(
      fc.property(arbBytes, (raw) => {
        expect(() => readProgress(raw)).not.toThrow()
        expect(() => readPrefs(raw)).not.toThrow()
        checkProgress(raw)
        checkPrefs(raw)
      }),
      { seed: SEED, numRuns: 500 },
    )
  })

  it('random near-valid records never throw and salvage to a valid record (with a coverage floor)', () => {
    const seen = new Set<ReadIssueCode | 'clean' | 'newer'>()
    fc.assert(
      fc.property(arbProgress, (value) => {
        const raw = JSON.stringify(value) ?? 'undefined'
        const read = readProgress(raw)
        if (read.kind === 'newer-schema') seen.add('newer')
        else if (read.issues.length === 0) seen.add('clean')
        else for (const issue of read.issues) seen.add(issue.code)
        checkProgress(raw)
        checkPrefs(raw)
      }),
      { seed: SEED, numRuns: 1000 },
    )
    // Guard against a vacuous property: every kind of salvage was reached.
    for (const code of [
      'clean',
      'newer',
      'top-level',
      'unknown-key',
      'story-dropped',
      'run-reset',
      'endings-invalid',
      'endings-duplicate',
      'endings-over-cap',
    ] as const) {
      expect(seen, code).toContain(code)
    }
  })
})
