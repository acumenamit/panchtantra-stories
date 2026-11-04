// Narration recipe @2 (decided 2026-11-04): AI4Bharat Indic Parler-TTS, voices Mary (en) and Divya (hi),
// generated on a Colab GPU from a plan made here; this PC checks and logs the results.
// Same scope as recipe @1: non-endings = story text, 0.8 s pause, question; endings = story text only.
// Choices and lesson cards are never read; asterisks are removed in the narration input only.
// The voice description, pauses and seed are exactly those of the listening test the owner approved.
// Each file is then levelled to a -1 dBFS peak before MP3 encoding (owner decision 2026-11-04: a plain volume
// change that removes the ~14 dB gap between Divya and Mary and keeps the MP3 below full scale).
import { jcsSha256 } from '../../src/core/hashing'
import type { StoryPackageV1 } from '../../src/core/package/v1'
import { narrationClean } from './recipe'

export const RECIPE_V2 = {
  version: 'narration-recipe@2',
  engine: 'AI4Bharat Indic Parler-TTS',
  model: 'ai4bharat/indic-parler-tts',
  voices: { en: 'Mary', hi: 'Divya' },
  descriptionTemplate:
    "{speaker}'s voice is warm and expressive, telling a story to children at a moderate pace, with very clear audio and no background noise.",
  sentenceGapS: 0.25,
  questionGapS: 0.8,
  seed: 0,
  levelPeakDbfs: -1,
  output: { container: 'mp3', sampleRateHz: 24000, bitrateKbps: 48, channels: 1 },
} as const

export type ParlerLocale = keyof typeof RECIPE_V2.voices

export function isParlerLocale(l: string): l is ParlerLocale {
  return l in RECIPE_V2.voices
}

/** Same split as the approved test notebook: after . ! ? । (optionally followed by a closing quote). */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\n/g, ' ').trim()
  return flat
    .split(/(?<=[.!?।])\s+|(?<=[.!?।]["”])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function describeVoice(speaker: string): string {
  return RECIPE_V2.descriptionTemplate.replace('{speaker}', speaker)
}

export interface ParlerPlanEntry {
  readonly storyId: string
  readonly nodeId: string
  readonly locale: ParlerLocale
  readonly voice: string
  readonly description: string
  readonly sentences: readonly string[]
  readonly question: string | null
  readonly seed: number
  readonly sentenceGapS: number
  readonly questionGapS: number
  readonly levelPeakDbfs: number
  readonly file: string // <storyId>/<nodeId>.<locale>.mp3
  readonly characters: number // spoken characters (text + question), for duration checks
  readonly narratedTextSha256: string
}

/** Builds one plan entry. The fingerprint covers everything that shapes the audio. */
export async function buildParlerEntry(
  pkg: StoryPackageV1,
  nodeId: string,
  locale: ParlerLocale,
  seed: number = RECIPE_V2.seed,
): Promise<ParlerPlanEntry> {
  const node = pkg.nodes.find((n) => n.id === nodeId)
  const nt = pkg.text[locale]?.nodes[nodeId]
  if (!node || !nt) throw new Error(`${pkg.storyId}/${nodeId}/${locale}: node or text missing`)
  const sentences = splitSentences(narrationClean(nt.text))
  const question = node.type !== 'ending' && nt.question ? narrationClean(nt.question) : null
  const voice = RECIPE_V2.voices[locale]
  const description = describeVoice(voice)
  const narratedTextSha256 = await jcsSha256({
    recipe: RECIPE_V2.version,
    model: RECIPE_V2.model,
    locale,
    voice,
    description,
    sentences,
    question,
    seed,
    sentenceGapS: RECIPE_V2.sentenceGapS,
    questionGapS: RECIPE_V2.questionGapS,
    levelPeakDbfs: RECIPE_V2.levelPeakDbfs,
  })
  const characters = [...sentences.join(' ')].length + (question ? [...question].length : 0)
  return {
    storyId: pkg.storyId,
    nodeId,
    locale,
    voice,
    description,
    sentences,
    question,
    seed,
    sentenceGapS: RECIPE_V2.sentenceGapS,
    questionGapS: RECIPE_V2.questionGapS,
    levelPeakDbfs: RECIPE_V2.levelPeakDbfs,
    file: `${pkg.storyId}/${nodeId}.${locale}.mp3`,
    characters,
    narratedTextSha256,
  }
}

/** Versions that must be the same for every file (pinned by the first Colab run). */
export interface MadeWith {
  readonly modelRevision?: string
  readonly parlerCommit?: string
  readonly tokenizerRevision?: string
}

const VERSION_FIELDS = [
  ['modelRevision', 'model revision'],
  ['parlerCommit', 'Parler-TTS code commit'],
  ['tokenizerRevision', 'tokenizer revision'],
] as const

export interface QaInput extends MadeWith {
  readonly key: string
  readonly locale: string
  readonly characters: number
  readonly durationMs: number
  /** Peak of the decoded MP3 (after levelling and encoding), 0..1. */
  readonly mp3Peak?: number
  /** Longest quiet run INSIDE a sentence (the voice's own pauses around sentences are not counted). */
  readonly longestSilenceS?: number
  /** 1-based parts (sentences, then the question) whose audio reached the model's length limit. */
  readonly nearCapParts?: readonly number[]
  /** 1-based parts with (almost) no audible sound after levelling. */
  readonly quietParts?: readonly number[]
}

export interface QaFlag {
  readonly key: string
  readonly reasons: readonly string[]
}

export const QA_DEFAULTS = { low: 0.75, high: 1.33, maxSilenceS: 2.5, clipPeak: 0.999 } as const

function mostCommon(values: readonly string[]): string | undefined {
  const count = new Map<string, number>()
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
}

/**
 * Auto-checks (owner-approved approach): speaking rate far from the language's median, a clipped MP3,
 * an unexpected long silence inside a sentence, a sentence that may be cut off at the model's length limit,
 * a sentence with no audible sound, or a model/code/tokenizer version different from the other files.
 * `alreadyLogged` (files accepted earlier, from the media log) counts towards the usual versions only.
 * Flagged files are listened to and, if bad, remade with a new seed.
 */
export function qaFlags(
  items: readonly QaInput[],
  opts: { low: number; high: number; maxSilenceS: number; clipPeak: number } = QA_DEFAULTS,
  alreadyLogged: readonly MadeWith[] = [],
): QaFlag[] {
  const medianRate = new Map<string, number>()
  for (const locale of new Set(items.map((i) => i.locale))) {
    const rates = items
      .filter((i) => i.locale === locale && i.durationMs > 0)
      .map((i) => i.characters / (i.durationMs / 1000))
      .sort((a, b) => a - b)
    if (rates.length) medianRate.set(locale, rates[Math.floor(rates.length / 2)]!)
  }
  const usual = new Map(
    VERSION_FIELDS.map(([field]) => [
      field,
      mostCommon(
        [...items, ...alreadyLogged]
          .map((x) => x[field])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ]),
  )

  const flags: QaFlag[] = []
  for (const i of items) {
    const reasons: string[] = []
    const median = medianRate.get(i.locale)
    if (i.durationMs <= 0) reasons.push('empty audio')
    else if (median) {
      const ratio = i.characters / (i.durationMs / 1000) / median
      if (ratio < opts.low)
        reasons.push(
          `slow for its text (${(ratio * 100).toFixed(0)}% of median rate): possible extra or repeated audio`,
        )
      if (ratio > opts.high)
        reasons.push(
          `fast for its text (${(ratio * 100).toFixed(0)}% of median rate): possible skipped words`,
        )
    }
    if (i.mp3Peak !== undefined && i.mp3Peak >= opts.clipPeak)
      reasons.push(`clipping in the MP3 (peak ${i.mp3Peak.toFixed(3)})`)
    if (i.longestSilenceS !== undefined && i.longestSilenceS > opts.maxSilenceS)
      reasons.push(`long silence inside a sentence (${i.longestSilenceS.toFixed(1)} s)`)
    if (i.nearCapParts?.length)
      reasons.push(`may be cut off at the model's length limit (part ${i.nearCapParts.join(', ')})`)
    if (i.quietParts?.length) reasons.push(`no audible sound in part ${i.quietParts.join(', ')}`)
    for (const [field, label] of VERSION_FIELDS) {
      const v = i[field]
      const u = usual.get(field)
      if (v && u && v !== u) reasons.push(`made with ${label} ${v}, the others with ${u}`)
    }
    if (reasons.length) flags.push({ key: i.key, reasons })
  }
  return flags
}
