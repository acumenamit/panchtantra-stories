// Share from the ending card (Step 10c; design p1-step10-design.md D11-P14, §4.3, §8; spec §6.1
// player "Share", §6.5 feature detection). Pure and framework-free: the island passes the
// browser's navigator and its own status holder, a test passes fakes.
// - shareUrlOf: the player URL in the content locale (the language the reader is reading, which may
//   differ from the page's after a stored-first resume or a switch), built from the origin only, so
//   the page's query and hash never leave. Step 12 moves it to the landing URL (H-12a).
// - runShare(env, { title, url }), the chain:
//   1. While a share or a copy is pending, a tap is ignored (a second share() would reject with
//      InvalidStateError).
//   2. navigator.share when it and navigator.canShare({ title, url }) are present and canShare says
//      yes: resolves → idle; AbortError → idle, silent (the reader closed the sheet; also "no share
//      targets", R19); any other rejection → step 3. share() is called before any await, so it
//      runs inside the tap's user activation, and as a method of the navigator.
//   3. navigator.clipboard.writeText(url): resolves → copied ("Link copied.", shown and announced
//      by the island); absent or rejects → step 4.
//   4. manual: the island shows a read-only field holding the URL, focused and selected.
// - A chain that ends after its control left the page (the part changed while a copy or the share
//   sheet was pending: Try another path, Back, All stories) shows and announces nothing, and a
//   share that fails after that never reaches the clipboard (review R10c-STRESS-3, A11Y-10c-3).
// Feature detection only, never a user-agent read (spec §6.5). Imports are relative (C15).
import type { LocaleCode } from '../../core/locales'

/** idle: nothing shown; pending: a share or copy runs; copied: "Link copied."; manual: the field. */
export type ShareStatus = 'idle' | 'pending' | 'copied' | 'manual'

/** What is shared: the story title in the content locale and the player URL. */
export interface ShareTarget {
  readonly title: string
  readonly url: string
}

/** The parts of the browser's navigator the chain uses, each optional (feature detection). */
export interface ShareNavigator {
  readonly share?: ((data: ShareTarget) => Promise<void>) | undefined
  readonly canShare?: ((data: ShareTarget) => boolean) | undefined
  readonly clipboard?:
    { readonly writeText?: ((text: string) => Promise<void>) | undefined } | undefined
}

export interface ShareEnv {
  /** The browser's navigator, or a fake. */
  readonly navigator: ShareNavigator
  /** Whether the control that started the chain is still on the page. */
  readonly alive: () => boolean
  /** The status now; 'pending' while a share or a copy runs. */
  readonly status: () => ShareStatus
  /** Shows a new status: 'pending' first, then 'idle', 'copied' or 'manual'. */
  readonly setStatus: (status: ShareStatus) => void
}

/** The player URL in the content locale: no query, no hash. */
export function shareUrlOf(
  where: Pick<Location, 'origin'>,
  storyId: string,
  contentLocale: LocaleCode,
): string {
  return `${where.origin}/${contentLocale}/stories/${storyId}/read`
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name: unknown }).name === 'AbortError'
  )
}

/** Runs the share chain once; resolves to the status it ends with ('pending' when ignored). */
export async function runShare(env: ShareEnv, target: ShareTarget): Promise<ShareStatus> {
  if (env.status() === 'pending') return 'pending'
  env.setStatus('pending')
  const finish = (status: ShareStatus): ShareStatus => {
    // Gone: nothing is shown or announced over a part the reader has moved to.
    if (env.alive()) env.setStatus(status)
    return status
  }
  const nav = env.navigator
  let canShare = false
  try {
    canShare =
      typeof nav.share === 'function' &&
      typeof nav.canShare === 'function' &&
      nav.canShare(target) === true
  } catch {
    canShare = false
  }
  if (canShare && typeof nav.share === 'function') {
    try {
      await nav.share(target)
      return finish('idle')
    } catch (error) {
      if (isAbortError(error)) return finish('idle')
      // Any other rejection (TypeError, NotAllowedError, …) falls to the clipboard.
    }
  }
  // The share sheet failed after the control left the page: no copy the reader never sees.
  if (!env.alive()) return 'idle'
  const clipboard = nav.clipboard
  if (typeof clipboard === 'object' && clipboard !== null) {
    if (typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(target.url)
        return finish('copied')
      } catch {
        // A refused or failed copy falls to the read-only field.
      }
    }
  }
  return finish('manual')
}
