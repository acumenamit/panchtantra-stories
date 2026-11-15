// The featured rule (spec §3.2, REQ:67; design p1-step8-design.md §7, §10.1; P1-2b): every row.
import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { StoryPackageV1 } from '../package/v1'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import { FEATURE_MEDIA_CHECKS, featuredVerdict } from './featured'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const SHA = 'a'.repeat(64)
const hex = (i: number) => i.toString(16).padStart(64, '0')

const entry = (storyId: string, approved = true) => ({
  storyId,
  collectionId: 'panchatantra',
  version: 1,
  packagePath: `packages/${storyId}/${SHA}.json`,
  packageSha256: SHA,
  ...(approved ? { approvalSha256: SHA } : {}),
})

/** The two-paths fixture: no pictures and no narration, as every phase-1 package. */
const plain = (): Json => structuredClone(fixture) as Json

/** two-paths with a picture on every node and a narration for every node and locale. */
function complete(): Json {
  const p = plain()
  let n = 1
  for (const node of p.nodes) {
    const id = hex(n++)
    node.image = id
    p.assets.push({
      kind: 'image',
      id,
      width: 800,
      height: 600,
      variants: [{ path: `media/two-paths/${id}-w800.webp`, mime: 'image/webp', bytes: 1000 }],
      provenance: { origin: 'human' },
    })
    for (const locale of p.locales) {
      const audioId = hex(n++)
      p.assets.push({
        kind: 'audio',
        id: audioId,
        nodeId: node.id,
        locale,
        durationMs: 1000,
        variants: [
          { path: `media/two-paths/${audioId}-${locale}.mp3`, mime: 'audio/mpeg', bytes: 1000 },
        ],
        provenance: { origin: 'human' },
        narratedTextSha256: SHA,
      })
    }
  }
  return p
}

const built = (p: Json) => ({ pkg: StoryPackageV1.parse(p) })
const RS = PANCHATANTRA_RULESET

describe('featuredVerdict', () => {
  it('names the media checks it counts, in order', () => {
    expect(FEATURE_MEDIA_CHECKS).toEqual(['A001', 'A005', 'A006'])
  })

  it('row 1: no featured story named gives null and "featured none"', () => {
    expect(featuredVerdict(null, [entry('two-paths')], [], [built(complete())], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured none',
    })
    expect(featuredVerdict(null, [], [], [], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured none',
    })
  })

  it('row 2: a story the snapshot does not list is dropped as not-in-snapshot', () => {
    expect(
      featuredVerdict('lion-and-hare', [entry('two-paths')], [], [built(complete())], RS),
    ).toEqual({
      featuredStoryId: null,
      line: 'content: featured story=lion-and-hare dropped (reason=not-in-snapshot); featuredStoryId=null',
    })
  })

  it('row 3: an excluded (unapproved) story is dropped as approval-missing', () => {
    const e = entry('two-paths', false)
    expect(featuredVerdict('two-paths', [e], [e], [], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured story=two-paths dropped (reason=approval-missing); featuredStoryId=null',
    })
  })

  it('row 4: a built story without pictures and narration is dropped with the counts', () => {
    // 5 nodes without a picture (A006) and 5 nodes x 2 locales without narration (A005).
    expect(featuredVerdict('two-paths', [entry('two-paths')], [], [built(plain())], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured story=two-paths dropped (reason=media-incomplete A001=0 A005=10 A006=5); featuredStoryId=null',
    })
  })

  it('row 4: a dangling asset reference (A001) alone drops it', () => {
    const p = complete()
    p.nodes[0].image = 'e'.repeat(64) // names no image asset
    expect(featuredVerdict('two-paths', [entry('two-paths')], [], [built(p)], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured story=two-paths dropped (reason=media-incomplete A001=1 A005=0 A006=0); featuredStoryId=null',
    })
  })

  it('row 4: one missing narration drops it', () => {
    const p = complete()
    p.assets = p.assets.filter(
      (a: Json) => !(a.kind === 'audio' && a.nodeId === 'start' && a.locale === 'hi'),
    )
    expect(featuredVerdict('two-paths', [entry('two-paths')], [], [built(p)], RS).line).toBe(
      'content: featured story=two-paths dropped (reason=media-incomplete A001=0 A005=1 A006=0); featuredStoryId=null',
    )
  })

  it('row 4: uses its own --feature report, so a waived or warn-level finding elsewhere never helps', () => {
    // The CheckedPackage report (publish mode) has A005/A006 as warnings; featuredVerdict reads
    // only the package and validates it again with forFeature, where they are errors.
    const story = { ...built(plain()), report: { ok: true, findings: [] } }
    expect(
      featuredVerdict('two-paths', [entry('two-paths')], [], [story], RS).featuredStoryId,
    ).toBeNull()
  })

  it('row 5: a built story with complete media is featured', () => {
    expect(featuredVerdict('two-paths', [entry('two-paths')], [], [built(complete())], RS)).toEqual(
      {
        featuredStoryId: 'two-paths',
        line: 'content: featured story=two-paths',
      },
    )
  })

  it('row 5 in staging and fixtures: approval is not needed when nothing is excluded', () => {
    const e = entry('two-paths', false)
    expect(featuredVerdict('two-paths', [e], [], [built(complete())], RS).featuredStoryId).toBe(
      'two-paths',
    )
  })

  it('never falls back to another story', () => {
    const others = [built(complete())]
    const r = featuredVerdict('lion-and-hare', [entry('two-paths')], [], others, RS)
    expect(r.featuredStoryId).toBeNull()
  })

  it('drops a listed, unexcluded story that was not built (cannot happen in the loader)', () => {
    expect(featuredVerdict('two-paths', [entry('two-paths')], [], [], RS)).toEqual({
      featuredStoryId: null,
      line: 'content: featured story=two-paths dropped (reason=not-built); featuredStoryId=null',
    })
  })

  it('always gives exactly one content: featured line', () => {
    const cases = [
      featuredVerdict(null, [], [], [], RS),
      featuredVerdict('x-y', [], [], [], RS),
      featuredVerdict('two-paths', [entry('two-paths')], [], [built(plain())], RS),
      featuredVerdict('two-paths', [entry('two-paths')], [], [built(complete())], RS),
    ]
    for (const { line } of cases) {
      expect(line.split('\n')).toHaveLength(1)
      expect(line).toMatch(/^content: featured /)
    }
  })
})
