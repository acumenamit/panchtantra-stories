// Narration recipe (OD-20, as decided 2026-10-21). Pure: builds the exact SSML sent to Azure.
// Scope: non-endings read the story text, an 800 ms pause, then the question; endings read the story
// text only (it ends with the teaching line). Choices and lesson cards are not read. Asterisks are
// removed in the narration input only; the stored story text is never changed.
import type { LocaleCode } from '../../src/core/locales'
import type { StoryPackageV1 } from '../../src/core/package/v1'

export const RECIPE = {
  version: 'narration-recipe@1',
  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  pauseBeforeQuestionMs: 800,
  rate: 'voice default',
  voices: { en: 'en-IN-NeerjaNeural', hi: 'hi-IN-MadhurNeural' },
  xmlLang: { en: 'en-IN', hi: 'hi-IN' },
} as const

type NarratedLocale = keyof typeof RECIPE.voices

export function isNarratedLocale(l: LocaleCode): l is NarratedLocale {
  return l in RECIPE.voices
}

/** XML-escape text content: & < > are required; quotes and apostrophes per Azure's SSML guidance. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const narrationClean = (s: string): string => s.replace(/\*/g, '')

export interface NarrationInput {
  readonly storyId: string
  readonly nodeId: string
  readonly locale: NarratedLocale
  readonly text: string
  readonly question: string | null
  readonly ssml: string
}

export function buildNarrationInput(
  pkg: StoryPackageV1,
  nodeId: string,
  locale: NarratedLocale,
): NarrationInput {
  const node = pkg.nodes.find((n) => n.id === nodeId)
  const nt = pkg.text[locale]?.nodes[nodeId]
  if (!node || !nt) throw new Error(`${pkg.storyId}/${nodeId}/${locale}: node or text missing`)
  const text = narrationClean(nt.text)
  const question = node.type !== 'ending' && nt.question ? narrationClean(nt.question) : null
  const body =
    escapeXml(text) +
    (question !== null
      ? `<break time="${RECIPE.pauseBeforeQuestionMs}ms"/>${escapeXml(question)}`
      : '')
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${RECIPE.xmlLang[locale]}">` +
    `<voice name="${RECIPE.voices[locale]}">${body}</voice></speak>`
  return { storyId: pkg.storyId, nodeId, locale, text, question, ssml }
}

/** Azure bills every SSML character except the <speak> and <voice> tags (Azure TTS pricing note). */
export function billableCharacters(ssml: string): number {
  return [...ssml.replace(/<\/?speak[^>]*>/g, '').replace(/<\/?voice[^>]*>/g, '')].length
}
