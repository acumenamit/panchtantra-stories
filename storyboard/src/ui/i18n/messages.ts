import 'server-only'
// The UI message catalogues (spec §6.6 i18n; P1 D8; design p1-step7-design.md §6.1, §6.6; P1-1c).
// The only importer of messages/{en,hi}.json. Server only: Server Components call t() and pass
// finished strings to Client Components as props, so no catalogue reaches client JS.
// - MessageKey comes from the English file; HI is typed against it, so a key missing from Hindi
//   is a tsc error (extra keys fail the parity test).
// - t() parses each message once (cached) with the in-repo ICU subset and checks the arguments
//   against the stricter kind of the two languages: a missing, extra or wrong-kind argument
//   throws, so a bad string fails the build when the page is prerendered.
import en from '../../../messages/en.json'
import hi from '../../../messages/hi.json'
import {
  checkArguments,
  formatMessage,
  parseMessage,
  strictestKinds,
  type ArgKind,
  type MessageValues,
  type ParsedMessage,
} from '../../core/i18n/message-format'
import type { LocaleCode } from '../../core/locales'

export type MessageKey = keyof typeof en

const EN: Readonly<Record<MessageKey, string>> = en
const HI: Readonly<Record<MessageKey, string>> = hi

const CATALOGUES = { en: EN, hi: HI } as const

/** The locales that have a catalogue: the enabled UI locales. */
export type MessageLocale = keyof typeof CATALOGUES

export type Translate = (key: MessageKey, values?: MessageValues) => string

export function hasMessages(locale: string): locale is MessageLocale {
  return Object.hasOwn(CATALOGUES, locale)
}

const parsed = new Map<string, ParsedMessage>()
const kinds = new Map<MessageKey, ReadonlyMap<string, ArgKind>>()

function parsedOf(locale: MessageLocale, key: MessageKey): ParsedMessage {
  const cacheKey = `${locale}:${key}`
  let message = parsed.get(cacheKey)
  if (message === undefined) {
    message = parseMessage(CATALOGUES[locale][key])
    parsed.set(cacheKey, message)
  }
  return message
}

/** The arguments a key takes: the same names in both languages, the stricter kind of the two. */
export function argumentKinds(key: MessageKey): ReadonlyMap<string, ArgKind> {
  let merged = kinds.get(key)
  if (merged === undefined) {
    merged = strictestKinds(parsedOf('en', key).args, parsedOf('hi', key).args)
    kinds.set(key, merged)
  }
  return merged
}

/** t(key, values?) for one locale; throws for a locale without a catalogue (ar is disabled). */
export function translator(locale: LocaleCode): Translate {
  if (!hasMessages(locale)) throw new Error(`no UI messages for locale "${locale}"`)
  const catalogue = CATALOGUES[locale]
  return (key, values = {}) => {
    if (!Object.hasOwn(catalogue, key)) throw new Error(`unknown message key "${key}"`)
    checkArguments(argumentKinds(key), values)
    return formatMessage(locale, parsedOf(locale, key), values)
  }
}
