// Locale registry (spec §4.5). Pure data; direction and script come from here, not from packages.
// "disabled" = no pages are built for it; it is used by RTL tests and validators only.

export const LOCALE_CODES = ['en', 'hi', 'ar'] as const

export type LocaleCode = (typeof LOCALE_CODES)[number]

export type LocaleStatus = 'enabled' | 'disabled'

export interface LocaleDef {
  readonly code: LocaleCode
  readonly endonym: string
  readonly dir: 'ltr' | 'rtl'
  readonly script: 'Latn' | 'Deva' | 'Arab'
  readonly status: LocaleStatus
  readonly questionMarks: readonly string[]
}

export const LOCALES: readonly LocaleDef[] = [
  {
    code: 'en',
    endonym: 'English',
    dir: 'ltr',
    script: 'Latn',
    status: 'enabled',
    questionMarks: ['?'],
  },
  {
    code: 'hi',
    endonym: 'हिन्दी',
    dir: 'ltr',
    script: 'Deva',
    status: 'enabled',
    questionMarks: ['?'],
  },
  {
    code: 'ar',
    endonym: 'العربية',
    dir: 'rtl',
    script: 'Arab',
    status: 'disabled',
    questionMarks: ['؟', '?'],
  },
]

export function isLocaleCode(value: string): value is LocaleCode {
  return (LOCALE_CODES as readonly string[]).includes(value)
}

export function getLocaleDef(code: LocaleCode): LocaleDef {
  const def = LOCALES.find((l) => l.code === code)
  if (!def) throw new Error(`Locale registry is missing ${code}`)
  return def
}

export function isEnabledLocale(code: string): boolean {
  return LOCALES.some((l) => l.code === code && l.status === 'enabled')
}

export const ENABLED_LOCALE_CODES: readonly LocaleCode[] = LOCALES.filter(
  (l) => l.status === 'enabled',
).map((l) => l.code)
