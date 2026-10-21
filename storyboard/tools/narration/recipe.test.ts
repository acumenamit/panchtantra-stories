import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/packages/two-paths.json'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { mp3Info } from './mp3'
import { RECIPE, billableCharacters, buildNarrationInput, escapeXml } from './recipe'

const pkg = StoryPackageV1.parse(fixture)

describe('narration recipe', () => {
  it('reads text, an 800 ms pause, then the question on a non-ending', () => {
    const x = buildNarrationInput(pkg, 'start', 'en')
    expect(x.ssml).toContain('<break time="800ms"/>')
    expect(x.ssml).toContain(escapeXml(pkg.text.en!.nodes.start!.question!))
    expect(x.ssml.indexOf('<break')).toBeGreaterThan(x.ssml.indexOf('A young fox'))
  })

  it('never reads the choices', () => {
    const x = buildNarrationInput(pkg, 'start', 'en')
    for (const c of Object.values(pkg.text.en!.nodes.start!.choices!))
      expect(x.ssml).not.toContain(c)
  })

  it('reads only the story text on an ending (no question, no lesson card)', () => {
    const x = buildNarrationInput(pkg, 'ending_wise', 'hi')
    expect(x.question).toBeNull()
    expect(x.ssml).not.toContain('<break')
    expect(x.ssml).not.toContain(pkg.text.hi!.nodes.ending_wise!.lesson!)
  })

  it('uses the decided voice and language per locale', () => {
    expect(buildNarrationInput(pkg, 'start', 'en').ssml).toContain(
      `<voice name="${RECIPE.voices.en}">`,
    )
    expect(buildNarrationInput(pkg, 'start', 'hi').ssml).toContain('xml:lang="hi-IN"')
    expect(RECIPE.outputFormat).toBe('audio-24khz-48kbitrate-mono-mp3')
  })

  it('removes asterisks in the narration input only, never in the stored package', () => {
    const p = structuredClone(fixture) as typeof fixture
    p.text.en.nodes.start.text = 'A *very* young fox.'
    const parsed = StoryPackageV1.parse(p)
    expect(buildNarrationInput(parsed, 'start', 'en').text).toBe('A very young fox.')
    expect(parsed.text.en!.nodes.start!.text).toBe('A *very* young fox.')
  })

  it('escapes XML special characters, including quotes', () => {
    expect(escapeXml(`Fox & "Crow" <x> 'y'`)).toBe(
      'Fox &amp; &quot;Crow&quot; &lt;x&gt; &apos;y&apos;',
    )
  })

  it('bills every SSML character except the speak and voice tags', () => {
    const x = buildNarrationInput(pkg, 'ending_quick', 'en')
    expect(billableCharacters(x.ssml)).toBe([...escapeXml(x.text)].length)
  })

  it('is deterministic (same input, same SSML)', () => {
    expect(buildNarrationInput(pkg, 'start', 'hi').ssml).toBe(
      buildNarrationInput(pkg, 'start', 'hi').ssml,
    )
  })
})

describe('mp3Info', () => {
  it('reads 48 kbps, 24 kHz, mono MPEG-2 Layer III frames and their duration', () => {
    // MPEG-2 L3, 48 kbps (index 6), 24 kHz (index 1), no padding, mono: frame = 72*48000/24000 = 144 bytes.
    const frame = new Uint8Array(144)
    frame.set([0xff, 0xf3, 0x64, 0xc0])
    const buf = new Uint8Array(144 * 10)
    for (let i = 0; i < 10; i++) buf.set(frame, i * 144)
    const info = mp3Info(buf)
    expect(info).toMatchObject({ frames: 10, kbps: [48], sampleRate: 24000, mono: true })
    expect(info.durationMs).toBe(240) // 10 frames x 576 samples / 24000 Hz
  })
})
