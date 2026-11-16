import 'server-only'
// The player's strings (Step 10a; design p1-step10-design.md D11-P2, §0.2): built on the server
// with t() in the route locale (the chrome language), passed to the client island as props. The
// "Page n" live-region text is pre-formatted for every n the story can reach, so no catalogue,
// template or formatter reaches the browser (spec §6.7). Story text is not a message: it comes
// from the package through PlayerData.
import type { LocaleCode } from '../../core/locales'
import type { PlayerData } from '../../reader/player/player-data'
import { translator } from '../i18n/messages'
import type { PlayerFallbackStrings, PlayerStrings } from './types'

/** The error fallback's strings (D11-P17). */
export function playerFallbackStringsOf(locale: LocaleCode): PlayerFallbackStrings {
  const t = translator(locale)
  return {
    errorTitle: t('player.errorTitle'),
    startThisAgain: t('player.startThisAgain'),
    allStories: t('player.allStories'),
    storageTitle: t('storage.title'),
    storageBody: t('storage.body'),
  }
}

/** Every string the player island shows in the route locale; page[n - 1] is "Page n". */
export function playerStringsOf(
  locale: LocaleCode,
  data: Pick<PlayerData, 'nodes'>,
): PlayerStrings {
  const t = translator(locale)
  return {
    ...playerFallbackStringsOf(locale),
    navLabel: t('header.navLabel'),
    grownUps: t('header.grownUps'),
    page: data.nodes.map((_, index) => t('player.page', { n: index + 1 })),
  }
}
