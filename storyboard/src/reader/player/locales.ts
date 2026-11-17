// The story-language switch's target (Step 10d; design p1-step10-design.md D11-P4, §5; spec §6.2
// SET_LOCALE "Locale is in the package"). Pure and framework-free.
// - localeSwitchOf(data, contentLocale): the language the switch offers, or null when the story
//   has no other on this page. It is the first of data.locales (the package's locales that the
//   site also enables, in registry order; playerDataOf) that is not the content locale, so a
//   locale the package lacks, or one the site does not enable, is never offered and the engine
//   never refuses the switch (its SET_LOCALE guard).
// - With en and hi enabled: an en/hi story offers the other one; an English-only story offers
//   nothing, so the island renders no switch.
// Imports are relative (C15): Vitest has no `@/` alias.
import type { LocaleCode } from '../../core/locales'
import type { PlayerData } from './player-data'

/** The locale the story-language switch offers, or null when the page has no other. */
export function localeSwitchOf(
  data: Pick<PlayerData, 'locales'>,
  contentLocale: LocaleCode,
): LocaleCode | null {
  return data.locales.find((code) => code !== contentLocale) ?? null
}
