'use client'
// The story landing's actions (P1 Step 12; design p1-step12-design.md §3.9 N10, §3.10 N11, §3.11
// N12, §3.13 N14, §4.5, §4.7, §4.11, §4.12; spec SPEC:434, :463, :468). Rendered as direct
// children of the landing's [data-landing] wrapper, in this order:
// - [data-actions] (data-shown pending|start|continue): a reserved primary cell holding Start and
//   Continue in one grid area (both held links to the player, which opens stored-first), then a
//   reserved Start again slot (a button). Pending and start: Start shown; continue (a saved run):
//   Continue and Start again shown. Hidden variants are visibility: hidden and aria-hidden, so the
//   row keeps its boxes in every state and the read moves nothing (N6). The server HTML and the
//   first client render are pending.
// - How this story was made: a held link to /{locale}/grown-ups#how-stories-are-made, same tab
//   (a dead anchor until Step 21 gives the section its id, H-21). The href arrives built from the
//   server (src/ui/story/strings.ts), so this island does not import the player's narration module.
// - [data-share-row]: ShareControl's Share button (and "Link copied." after it), with holdOnShare in
//   the capture phase, so every Share tap starts the navigation hold before the share chain runs
//   (S12-CRIT-2); then ShareControl's manual field on its own line, the last thing on the page.
// - Start again: createStartAgain (hold, then progress.resetRun, then router.push to /read, also
//   after a rejected reset; one call per mount). No question is asked here (owner Q3 (a)).
// - The saved-run hint (round 1b, design §16 F1, H-12c; round 2b, §19): the onNavigate of Continue
//   and of Start, in every state, sets html[data-saved-run] before the soft navigation, so a player
//   that resumes a saved run never paints the start passage first (../shell/saved-run-mark.ts).
//   Start sets it after the read too: a run saved in another tab after this page's one read (N8)
//   still resumes. On a fresh Start it hides the run area for the opening frames only.
// - StoryActions reads progress.get(storyId) once after mount and on pageshow(persisted) through
//   createLatestRead; it never subscribes and never writes. A newer-schema record moves the store
//   to memory on this read, so the storage banner can appear after it (accepted, design E10).
// StoryActionsView renders each state from props (markup tests, 13.11 item 5d).
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { StoryProgress } from '../../core/progress'
import type { LocaleCode } from '../../core/locales'
import { readerStores } from '../../reader/progress'
import { createLatestRead } from '../../reader/shelf/latest-read'
import { ShareControl } from '../player/share-control'
import { HeldLink } from '../shell/held-link'
import { holdNavigation } from '../shell/nav-hold'
import { markSavedRun } from '../shell/saved-run-mark'
import { createStartAgain } from './start-again'
import styles from './story.module.css'

/** pending: before the first read (server HTML, hydration); then start or continue. */
export type ActionsState = 'pending' | 'start' | 'continue'

export interface StoryActionsStrings {
  readonly start: string
  readonly continue: string
  readonly startAgain: string
  readonly howMade: string
  readonly share: string
  readonly linkCopied: string
  readonly copyLink: string
}

/** No stored entry, or no saved run (any endings): start; a saved run: continue. */
export function actionsStateOf(
  entry: Pick<StoryProgress, 'activeRun'> | null,
): Exclude<ActionsState, 'pending'> {
  return entry !== null && entry.activeRun !== null ? 'continue' : 'start'
}

/**
 * The Share row's capture-phase click handler: holds when the click is inside the Share button,
 * never for "Link copied." or the row itself. Duck-typed, so Vitest's node environment can call it.
 */
export function holdOnShare(event: { readonly target: unknown }): void {
  const target = event.target as { closest?: (selector: string) => unknown } | null
  if (typeof target?.closest === 'function' && target.closest('button[data-share]') !== null) {
    holdNavigation()
  }
}

export interface StoryActionsViewProps {
  readonly state: ActionsState
  readonly storyId: string
  /** The page locale: the landing's content locale. */
  readonly locale: LocaleCode
  /** The story title in the page locale (the share sheet's title). */
  readonly title: string
  /** /{locale}/grown-ups#how-stories-are-made, built on the server. */
  readonly howMadeHref: string
  readonly strings: StoryActionsStrings
  readonly onStartAgain: () => void
}

const variantClass = (base: string | undefined, visible: boolean): string =>
  visible ? (base ?? '') : `${base} ${styles.hidden}`

export function StoryActionsView({
  state,
  storyId,
  locale,
  title,
  howMadeHref,
  strings,
  onStartAgain,
}: StoryActionsViewProps) {
  const readUrl = `/${locale}/stories/${storyId}/read`
  const saved = state === 'continue'
  return (
    <>
      <div data-actions="" data-shown={state} className={styles.actions}>
        <div className={styles.primary}>
          <HeldLink
            href={readUrl}
            data-story-action="start"
            aria-hidden={saved ? true : undefined}
            className={variantClass(`${styles.action} ${styles.primaryVariant}`, !saved)}
            onNavigate={markSavedRun}
          >
            <span className={styles.actionLabel}>{strings.start}</span>
          </HeldLink>
          <HeldLink
            href={readUrl}
            data-story-action="continue"
            onNavigate={markSavedRun}
            aria-hidden={saved ? undefined : true}
            className={variantClass(`${styles.action} ${styles.primaryVariant}`, saved)}
          >
            <span className={styles.actionLabel}>{strings.continue}</span>
          </HeldLink>
        </div>
        <div className={styles.againSlot}>
          <button
            type="button"
            data-start-again=""
            aria-hidden={saved ? undefined : true}
            className={variantClass(styles.secondary, saved)}
            onClick={onStartAgain}
          >
            <span className={styles.actionLabel}>{strings.startAgain}</span>
          </button>
        </div>
      </div>
      <HeldLink href={howMadeHref} data-how-made="" className={styles.howMade}>
        {strings.howMade}
      </HeldLink>
      <ShareControl
        title={title}
        storyId={storyId}
        contentLocale={locale}
        strings={{
          share: strings.share,
          linkCopied: strings.linkCopied,
          copyLink: strings.copyLink,
        }}
      >
        {({ share, field }) => (
          <>
            <div data-share-row="" onClickCapture={holdOnShare} className={styles.shareRow}>
              {share}
            </div>
            {field}
          </>
        )}
      </ShareControl>
    </>
  )
}

export interface StoryActionsProps {
  readonly storyId: string
  readonly locale: LocaleCode
  readonly title: string
  readonly howMadeHref: string
  readonly strings: StoryActionsStrings
}

export function StoryActions({ storyId, locale, title, howMadeHref, strings }: StoryActionsProps) {
  const router = useRouter()
  const [state, setState] = useState<ActionsState>('pending')

  useEffect(() => {
    const latest = createLatestRead<StoryProgress | null>({
      read: () => readerStores().progress.get(storyId),
      apply: (entry) => setState(actionsStateOf(entry)),
      empty: null,
      now: () => Date.now(),
    })
    latest.run()
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) latest.run()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      latest.dispose()
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [storyId])

  const startAgain = useMemo(
    () =>
      createStartAgain({
        hold: () => holdNavigation(),
        reset: () => readerStores().progress.resetRun(storyId),
        navigate: (url) => router.push(url),
        readUrl: `/${locale}/stories/${storyId}/read`,
      }),
    [router, storyId, locale],
  )

  return (
    <StoryActionsView
      state={state}
      storyId={storyId}
      locale={locale}
      title={title}
      howMadeHref={howMadeHref}
      strings={strings}
      onStartAgain={() => void startAgain()}
    />
  )
}
