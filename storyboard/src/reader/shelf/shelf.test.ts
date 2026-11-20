// The shelf rules (P1 Step 12, design p1-step12-design.md §3.2 N3, §3.4 N5, §3.6 N7, §4.3, §4.4;
// test plan T12-1 to T12-4). Pure: sortShelf (addedOn descending, then storyId in code units),
// badgeOf (Reading > Finished · x of y > New; New by the UTC midnight of addedOn, a negative age
// included; the DEC:19 A7 artefact counts as not started), isNewStory and NEW_FOR_MS, and
// continueOf (the saved run of a listed story with the highest recency, byRecency). Every expected
// value is typed here, never computed from the code under test.
import { describe, expect, it } from 'vitest'
import type { ProgressEntry } from '../../core/progress'
import { badgeOf, continueOf, isNewStory, NEW_FOR_MS, sortShelf, type Badge } from './shelf'

const DAY = 86_400_000
/** UTC midnight of 2026-11-13, the addedOn of the badge rows. */
const ADDED = Date.UTC(2026, 10, 13)
const ENDINGS = ['ending_light', 'ending_shadow'] as const
const RUN = { path: ['start', 'c1'], locale: 'en' } as const

describe('sortShelf (T12-1, N3)', () => {
  const INPUT = [
    { storyId: 'b', addedOn: '2026-03-07' },
    { storyId: 'a', addedOn: '2026-03-07' },
    { storyId: 'z', addedOn: '2026-11-13' },
    { storyId: 'm', addedOn: '2026-03-09' },
    { storyId: 'k', addedOn: '2026-03-09' },
  ] as const

  it('(g1) orders by addedOn descending', () => {
    const dates = sortShelf(INPUT).map((s) => s.addedOn)
    expect
      .soft(dates, '(g1) addedOn descending')
      .toEqual(['2026-11-13', '2026-03-09', '2026-03-09', '2026-03-07', '2026-03-07'])
  })

  it('(g2) breaks ties by storyId ascending in code units (two ties given in reverse order)', () => {
    expect
      .soft(
        sortShelf(INPUT).map((s) => s.storyId),
        '(g2) ties by id',
      )
      .toEqual(['z', 'k', 'm', 'a', 'b'])
    // Code units, not the locale's collation: 'B' (0x42) sorts before 'a' (0x61).
    const cased = [
      { storyId: 'a', addedOn: '2026-01-01' },
      { storyId: 'B', addedOn: '2026-01-01' },
    ]
    expect
      .soft(
        sortShelf(cased).map((s) => s.storyId),
        '(g2) code units',
      )
      .toEqual(['B', 'a'])
  })

  it('(g3) leaves the input unchanged and returns the same stories', () => {
    // A fresh, unsorted array of its own (an in-place sort in g1 or g2 cannot have ordered it), not
    // frozen, so an in-place sort reaches the assertions below.
    const input = [
      { storyId: 'b', addedOn: '2026-03-07' },
      { storyId: 'z', addedOn: '2026-11-13' },
      { storyId: 'a', addedOn: '2026-03-07' },
    ]
    const before = JSON.stringify(input)
    const sorted = sortShelf(input)
    expect.soft(JSON.stringify(input), '(g3) input not mutated').toBe(before)
    expect.soft(sorted, '(g3) a new array').not.toBe(input)
    expect.soft(sorted.map((s) => s.storyId).sort(), '(g3) same ids').toEqual(['a', 'b', 'z'])
  })
})

describe('badgeOf (T12-2, N5, §3.4)', () => {
  type Row = readonly [
    name: string,
    entry: { activeRun: typeof RUN | null; endingsFound: readonly string[] } | null,
    at: number,
    expected: Badge,
  ]
  const ROWS: readonly Row[] = [
    ['run, no endings', { activeRun: RUN, endingsFound: [] }, ADDED + 3 * DAY, { kind: 'reading' }],
    [
      'run and an ending: Reading beats Finished',
      { activeRun: RUN, endingsFound: ['ending_light'] },
      ADDED + 3 * DAY,
      { kind: 'reading' },
    ],
    [
      'null run, one ending: Finished beats New',
      { activeRun: null, endingsFound: ['ending_light'] },
      ADDED + 3 * DAY,
      { kind: 'finished', found: 1 },
    ],
    [
      'null run, both endings',
      { activeRun: null, endingsFound: ['ending_light', 'ending_shadow'] },
      ADDED + 3 * DAY,
      { kind: 'finished', found: 2 },
    ],
    [
      'null run, one ending and a stale id: only current ids count',
      { activeRun: null, endingsFound: ['ending_light', 'gone'] },
      ADDED + 3 * DAY,
      { kind: 'finished', found: 1 },
    ],
    [
      'null run, only a stale id (the A7 artefact), recent: not started, New',
      { activeRun: null, endingsFound: ['gone'] },
      ADDED + 3 * DAY,
      { kind: 'new' },
    ],
    [
      'null run, only a stale id, old: nothing',
      { activeRun: null, endingsFound: ['gone'] },
      ADDED + 20 * DAY,
      null,
    ],
    ['no entry, recent', null, ADDED + 3 * DAY, { kind: 'new' }],
    ['no entry, old', null, ADDED + 20 * DAY, null],
    ['no entry, exactly 7 days', null, ADDED + 7 * DAY, { kind: 'new' }],
    ['no entry, 7 days and 1 ms', null, ADDED + 7 * DAY + 1, null],
    ['no entry, a day before addedOn (a negative age is New)', null, ADDED - DAY, { kind: 'new' }],
    [
      'null run, no endings, recent: as not started',
      { activeRun: null, endingsFound: [] },
      ADDED + 3 * DAY,
      { kind: 'new' },
    ],
    [
      'null run, no endings, old: as not started',
      { activeRun: null, endingsFound: [] },
      ADDED + 20 * DAY,
      null,
    ],
  ]

  it('has 14 distinct rows', () => {
    expect(ROWS).toHaveLength(14)
    expect(new Set(ROWS.map(([name]) => name)).size).toBe(14)
  })

  it.each(ROWS)('%s', (_name, entry, now, expected) => {
    expect(badgeOf({ entry, endingIds: ENDINGS, addedOn: '2026-11-13', now })).toEqual(expected)
  })
})

describe('isNewStory and NEW_FOR_MS (T12-3)', () => {
  it('(g1) NEW_FOR_MS is 7 days in milliseconds', () => {
    expect.soft(NEW_FOR_MS, '(g1) NEW_FOR_MS').toBe(604_800_000)
  })

  it('(g2) New up to exactly 7 days after the UTC midnight of addedOn, and before it', () => {
    expect.soft(isNewStory('2026-11-13', Date.UTC(2026, 10, 20)), '(g2) 7 days').toBe(true)
    expect
      .soft(isNewStory('2026-11-13', Date.UTC(2026, 10, 20) + 1), '(g2) 7 days + 1 ms')
      .toBe(false)
    expect.soft(isNewStory('2026-11-13', Date.UTC(2026, 10, 12)), '(g2) a day before').toBe(true)
  })
})

describe('continueOf (T12-4, N7)', () => {
  const entry = (storyId: string, order: number, run: boolean): ProgressEntry => ({
    storyId,
    version: 1,
    activeRun: run ? RUN : null,
    endingsFound: [],
    order,
  })

  it('(g1) the highest order wins, whatever the input order', () => {
    const entries = [entry('a', 1, true), entry('c', 3, true), entry('b', 2, true)]
    expect.soft(continueOf(entries, ['a', 'b', 'c']), '(g1) highest order').toBe('c')
  })

  it('(g2) equal orders: storyId ascending (byRecency)', () => {
    const entries = [entry('y', 2, true), entry('x', 2, true), entry('w', 1, true)]
    expect.soft(continueOf(entries, ['w', 'x', 'y']), '(g2) tie by id').toBe('x')
  })

  it('(g3) skips an entry with no saved run, even at the highest order', () => {
    const entries = [entry('a', 5, false), entry('b', 2, true)]
    expect.soft(continueOf(entries, ['a', 'b']), '(g3) null run skipped').toBe('b')
  })

  it('(g4) skips a story this page does not list, even at the highest order', () => {
    const entries = [entry('gone', 9, true), entry('b', 2, true)]
    expect.soft(continueOf(entries, ['b']), '(g4) unlisted skipped').toBe('b')
  })

  it('(g5) none qualifies: null', () => {
    expect.soft(continueOf([entry('a', 1, false)], ['x', 'a']), '(g5) none').toBeNull()
    expect.soft(continueOf([], ['x']), '(g5) no entries').toBeNull()
  })
})
