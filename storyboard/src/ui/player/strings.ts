import 'server-only'
// The player's strings (Step 10a; design p1-step10-design.md D11-P2, §0.2): built on the server
// with t() in the route locale (the chrome language), passed to the client island as props. The
// "Page n" live-region text is pre-formatted for every n the story can reach, so no catalogue,
// template or formatter reaches the browser (spec §6.7). Story text is not a message: it comes
// from the package through PlayerData.
// Step 10b: Back, the menu, the restart dialog, the text-size labels (one per TEXT_SCALES value)
// and the progress bar's value text for every count from 0 to the story's step count.
// Step 10c: the ending card (D11-P13, P14) and the ending count "Ending {found} of {total} found"
// for every found from 0 to the story's ending count (the card and the live region, D11-P9).
import type { LocaleCode } from '../../core/locales'
import { TEXT_SCALES, type TextScale } from '../../core/progress'
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

/**
 * Every string the player island shows in the route locale; page[n - 1] is "Page n",
 * progressValue[filled] is "{filled} of {total}" and endingCount[found] is "Ending {found} of
 * {total} found".
 */
export function playerStringsOf(
  locale: LocaleCode,
  data: Pick<PlayerData, 'nodes' | 'progressSteps' | 'endingIds'>,
): PlayerStrings {
  const t = translator(locale)
  const total = data.progressSteps.length
  const endings = data.endingIds.length
  const textSizeOption = {} as Record<TextScale, string>
  for (const percent of TEXT_SCALES) {
    textSizeOption[percent] = t('player.textSizeOption', { percent })
  }
  return {
    ...playerFallbackStringsOf(locale),
    navLabel: t('header.navLabel'),
    grownUps: t('header.grownUps'),
    page: data.nodes.map((_, index) => t('player.page', { n: index + 1 })),
    back: t('player.back'),
    menu: t('player.menu'),
    textSize: t('player.textSize'),
    textSizeOption,
    restart: t('player.restart'),
    restartQuestion: t('player.restartQuestion'),
    keepReading: t('player.keepReading'),
    progress: t('player.progress'),
    progressValue: Array.from({ length: total + 1 }, (_, filled) =>
      t('player.progressValue', { filled, total }),
    ),
    endingCount: Array.from({ length: endings + 1 }, (_, found) =>
      t('player.endingCount', { found, total: endings }),
    ),
    lessonHeading: t('player.lessonHeading'),
    altEnding: t('player.altEnding'),
    tryAnother: t('player.tryAnother'),
    share: t('player.share'),
    linkCopied: t('player.linkCopied'),
    copyLink: t('player.copyLink'),
  }
}
