// Pure core module (no framework imports). Placeholder until P0-4 adds the schema.
export const APP_NAME = 'Storyboard'

export const SUPPORTED_LOCALES = ['en', 'hi'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}
