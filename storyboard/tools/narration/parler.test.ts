import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/packages/two-paths.json'
import { jcsSha256 } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { RECIPE_V2, buildParlerEntry, describeVoice, qaFlags, splitSentences } from './parler'

const pkg = StoryPackageV1.parse(fixture)

describe('recipe @2 (Indic Parler-TTS)', () => {
  it('uses the owner-chosen female voices and the tested description', () => {
    expect(RECIPE_V2.voices).toEqual({ en: 'Mary', hi: 'Divya' })
    expect(describeVoice('Mary')).toBe(
      "Mary's voice is warm and expressive, telling a story to children at a moderate pace, with very clear audio and no background noise.",
    )
    expect(RECIPE_V2.levelPeakDbfs).toBe(-1)
    expect(RECIPE_V2.output).toEqual({
      container: 'mp3',
      sampleRateHz: 24000,
      bitrateKbps: 48,
      channels: 1,
    })
  })

  it('splits sentences like the approved test notebook (English, Hindi, quoted speech)', () => {
    expect(splitSentences('A fox ran. "Stop!" he said.\nनमस्ते। ठीक है?')).toEqual([
      'A fox ran.',
      '"Stop!"',
      'he said.',
      'नमस्ते।',
      'ठीक है?',
    ])
  })

  it('reads text then the question on a non-ending, never the choices', async () => {
    const e = await buildParlerEntry(pkg, 'start', 'en')
    expect(e.voice).toBe('Mary')
    expect(e.question).toBe(pkg.text.en!.nodes.start!.question)
    for (const c of Object.values(pkg.text.en!.nodes.start!.choices!)) {
      expect(e.sentences.join(' ')).not.toContain(c)
      expect(e.question).not.toContain(c)
    }
    expect(e.file).toBe('two-paths/start.en.mp3')
  })

  it('reads only the story text on an ending (no question, no lesson card)', async () => {
    const e = await buildParlerEntry(pkg, 'ending_wise', 'hi')
    expect(e.voice).toBe('Divya')
    expect(e.question).toBeNull()
    expect(e.sentences.join(' ')).not.toContain(pkg.text.hi!.nodes.ending_wise!.lesson!)
  })

  it('removes asterisks in the narration input only', async () => {
    const p = structuredClone(fixture) as typeof fixture
    p.text.en.nodes.start.text = 'A *very* young fox stands.'
    const parsed = StoryPackageV1.parse(p)
    const e = await buildParlerEntry(parsed, 'start', 'en')
    expect(e.sentences).toEqual(['A very young fox stands.'])
    expect(parsed.text.en!.nodes.start!.text).toBe('A *very* young fox stands.')
  })

  it('fingerprints deterministically; a new seed or text gives a new fingerprint', async () => {
    const a = await buildParlerEntry(pkg, 'start', 'hi')
    const b = await buildParlerEntry(pkg, 'start', 'hi')
    const c = await buildParlerEntry(pkg, 'start', 'hi', 1)
    expect(a.narratedTextSha256).toBe(b.narratedTextSha256)
    expect(c.narratedTextSha256).not.toBe(a.narratedTextSha256)
    const p = structuredClone(fixture) as typeof fixture
    p.text.hi.nodes.start.text += ' नया।'
    const d = await buildParlerEntry(StoryPackageV1.parse(p), 'start', 'hi')
    expect(d.narratedTextSha256).not.toBe(a.narratedTextSha256)
    expect(a.levelPeakDbfs).toBe(-1)
  })

  it('the fingerprint covers the -1 dB levelling (a take made without it would not match)', async () => {
    const e = await buildParlerEntry(pkg, 'start', 'hi')
    const fields = {
      recipe: RECIPE_V2.version,
      model: RECIPE_V2.model,
      locale: e.locale,
      voice: e.voice,
      description: e.description,
      sentences: e.sentences,
      question: e.question,
      seed: e.seed,
      sentenceGapS: e.sentenceGapS,
      questionGapS: e.questionGapS,
    }
    expect(e.narratedTextSha256).toBe(await jcsSha256({ ...fields, levelPeakDbfs: -1 }))
    expect(e.narratedTextSha256).not.toBe(await jcsSha256(fields))
  })
})

describe('qaFlags (auto-checks)', () => {
  const normal = (key: string, durationMs: number) => ({
    key,
    locale: 'en',
    characters: 1000,
    durationMs,
  })
  const base = [normal('a', 70_000), normal('b', 72_000), normal('c', 68_000), normal('d', 71_000)]

  it('flags nothing for files with similar speaking rates and clean levels', () => {
    expect(
      qaFlags(
        base.map((x) => ({
          ...x,
          mp3Peak: 0.93,
          longestSilenceS: 0.9,
          nearCapParts: [],
          modelRevision: 'r1',
        })),
      ),
    ).toEqual([])
  })

  it('flags much slower or faster files (repeated or skipped words)', () => {
    const flags = qaFlags([...base, normal('slow', 120_000), normal('fast', 40_000)])
    expect(flags.map((f) => f.key).sort()).toEqual(['fast', 'slow'])
  })

  it('flags a clipped MP3, a long silence inside a sentence, a cut-off risk and empty audio', () => {
    const flags = qaFlags([
      ...base,
      { ...normal('clip', 70_000), mp3Peak: 1 },
      { ...normal('gap', 70_000), longestSilenceS: 4.2 },
      { ...normal('cap', 70_000), nearCapParts: [3, 7] },
      normal('empty', 0),
    ])
    expect(Object.fromEntries(flags.map((f) => [f.key, f.reasons.length]))).toEqual({
      clip: 1,
      gap: 1,
      cap: 1,
      empty: 1,
    })
    expect(flags.find((f) => f.key === 'cap')!.reasons[0]).toContain('part 3, 7')
  })

  it("does not flag a peak just under full scale (Mary's approved test peaked at 0.99945 before levelling)", () => {
    expect(qaFlags([...base, { ...normal('levelled', 70_000), mp3Peak: 0.95 }])).toEqual([])
  })

  it('flags a sentence with no audible sound', () => {
    const flags = qaFlags([...base, { ...normal('mute', 70_000), quietParts: [4] }])
    expect(flags).toEqual([{ key: 'mute', reasons: ['no audible sound in part 4'] }])
  })

  it('flags code or tokenizer versions that differ, counting files already in the media log', () => {
    const logged = Array.from({ length: 5 }, () => ({
      modelRevision: 'r1',
      parlerCommit: 'c1',
      tokenizerRevision: 't1',
    }))
    // All files in this run agree with each other, but not with the 5 already logged.
    const flags = qaFlags(
      base
        .slice(0, 2)
        .map((x) => ({ ...x, modelRevision: 'r1', parlerCommit: 'c2', tokenizerRevision: 't1' })),
      undefined,
      logged,
    )
    expect(flags.map((f) => f.reasons)).toEqual([
      ['made with Parler-TTS code commit c2, the others with c1'],
      ['made with Parler-TTS code commit c2, the others with c1'],
    ])
  })

  it('flags a file made with a different model revision than the others', () => {
    const flags = qaFlags([
      ...base.map((x) => ({ ...x, modelRevision: 'r1' })),
      { ...normal('odd', 70_000), modelRevision: 'r2' },
    ])
    expect(flags).toEqual([
      { key: 'odd', reasons: ['made with model revision r2, the others with r1'] },
    ])
  })
})
