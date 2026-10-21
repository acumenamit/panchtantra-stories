// Byte-equality check (M4): every legacy string must appear unchanged at its mapped place.
import type { StoryPackageV1 } from '../../src/core/package/v1'
import type { LegacyStory } from './load-legacy'

export interface StringDiff {
  readonly where: string
  readonly legacy: string | undefined
  readonly converted: string | undefined
}

export interface EqualityResult {
  readonly stringsCompared: Readonly<Record<'en' | 'hi', number>>
  readonly diffs: readonly StringDiff[]
}

export function compareStrings(legacy: LegacyStory, pkg: StoryPackageV1): EqualityResult {
  const diffs: StringDiff[] = []
  const counts = { en: 0, hi: 0 }
  const check = (where: string, l: 'en' | 'hi', a: string | undefined, b: unknown) => {
    if (a === undefined && b === undefined) return
    counts[l]++
    const converted = typeof b === 'string' ? b : undefined
    if (a !== converted) diffs.push({ where: `${l}:${where}`, legacy: a, converted })
  }

  for (const l of ['en', 'hi'] as const) {
    const t = pkg.text[l]
    for (const f of ['title', 'description', 'theme', 'duration', 'book'] as const) {
      check(f, l, legacy[f][l], t?.[f])
    }
    for (const [id, n] of Object.entries(legacy.nodes)) {
      const out = t?.nodes[id]
      check(`${id}.text`, l, n.text[l], out?.text)
      check(`${id}.question`, l, n.question?.[l], out?.question)
      check(`${id}.lesson`, l, n.lesson?.[l], out?.lesson)
      n.choices?.forEach((c, i) =>
        check(`${id}.choices.c${i + 1}`, l, c.text[l], out?.choices?.[`c${i + 1}`]),
      )
    }
  }
  return { stringsCompared: counts, diffs }
}
