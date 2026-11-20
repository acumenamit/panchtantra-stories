// The player's links to Home hold (P1 Step 12; design p1-step12-design.md §3.12 N13, §3.13 N14,
// §4.12; S12-CRIT-3; test plan T12-37). The three links to /{locale} (the header's Exit, the ending
// card's All stories and the error fallback's All stories) render through HeldLink, so a second
// tap of a double tap on Home within 500 ms lands on nothing; their href and markup stay the same
// (player.markup.test.ts is unchanged). The header's Grown-ups link and the AI voice byline
// (Step 11, H-21) stay plain next/link.
// HeldLink is a recording mock that renders <a data-held>; next/link is the real one.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { held } = vi.hoisted(() => ({ held: [] as Record<string, unknown>[] }))

vi.mock('../shell/held-link', async () => {
  const { createElement: h } = await import('react')
  function RecordingHeldLink(props: Record<string, unknown>) {
    held.push(props)
    const { href, children, ...rest } = props
    // next/link reads these two itself; they never reach the <a>.
    delete rest.prefetch
    delete rest.onNavigate
    return h('a', { 'data-held': '', href, ...rest }, children as never)
  }
  return { HeldLink: RecordingHeldLink }
})

import twoPaths from '../../../fixtures/packages/two-paths.json'
import { start, type StepResult } from '../../core/engine'
import { ENABLED_LOCALE_CODES, type LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import { graphOf, playerDataOf, type PlayerData } from '../../reader/player/player-data'
import { partViewOf } from '../../reader/player/view'
import { EndingCard } from './ending-card'
import { NarrationControls } from './narration-controls'
import { PlayerFallback } from './player-boundary'
import { PlayerHeader } from './player-header'
import { playerFallbackStringsOf, playerStringsOf } from './strings'

const data = playerDataOf(StoryPackageV1.parse(twoPaths), { locales: ENABLED_LOCALE_CODES })

function pathTo(player: PlayerData, target: string): string[] {
  const queue: string[][] = [[player.startNodeId]]
  while (queue.length > 0) {
    const path = queue.shift() ?? []
    const id = path[path.length - 1]
    if (id === target) return path
    const node = player.nodes.find((n) => n.id === id)
    for (const choice of node?.choices ?? []) queue.push([...path, choice.next])
  }
  throw new Error(`no path to ${target}`)
}

const refuse = (): StepResult => {
  throw new Error('no tap in a server render')
}

const anchors = (html: string): string[] => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
const hrefOf = (tag: string): string | undefined => /\shref="([^"]*)"/.exec(tag)?.[1]
const isHeld = (tag: string): boolean => /\sdata-held=""/.test(tag)

function renders(locale: LocaleCode) {
  const strings = playerStringsOf(locale, data)
  const header = renderToString(
    createElement(PlayerHeader, {
      locale,
      allStories: strings.allStories,
      navLabel: strings.navLabel,
      grownUps: strings.grownUps,
    }),
  )
  const view = partViewOf(data, start(graphOf(data), { path: pathTo(data, 'ending_wise'), locale }))
  const ending = renderToString(
    createElement(EndingCard, {
      view,
      storyId: data.storyId,
      locale,
      strings,
      count: strings.endingCount[1] ?? '',
      interactive: true,
      onTryAnother: refuse,
    }),
  )
  const fallback = renderToString(
    createElement(PlayerFallback, {
      storyId: data.storyId,
      locale,
      strings: playerFallbackStringsOf(locale),
    }),
  )
  const narration = renderToString(
    createElement(NarrationControls, {
      locale,
      display: { on: false, status: 'idle', playback: null, pulse: false, message: null },
      strings,
      onToggle: () => {},
      onPlayback: () => {},
    }),
  )
  return { header, ending, fallback, narration }
}

beforeEach(() => {
  held.length = 0
})

describe('the player’s links to Home go through HeldLink (T12-37, A16, S12-CRIT-3)', () => {
  it.each(ENABLED_LOCALE_CODES)(
    '%s: Exit, All stories and the fallback’s All stories',
    (locale) => {
      const { header, ending, fallback } = renders(locale)
      expect(held.length, 'precondition: three renders recorded held links').toBeGreaterThan(0)
      const home = `/${locale}`
      const exit = anchors(header).find((a) => /\sdata-exit=""/.test(a)) ?? ''
      const all = anchors(ending).find((a) => /\sdata-all-stories=""/.test(a)) ?? ''
      const back = anchors(fallback).find((a) => hrefOf(a) === home) ?? ''
      expect.soft(isHeld(exit) && hrefOf(exit) === home, '(g1) the header Exit is held').toBe(true)
      expect
        .soft(isHeld(all) && hrefOf(all) === home, '(g1) the ending card All stories is held')
        .toBe(true)
      expect.soft(isHeld(back), '(g1) the fallback All stories is held').toBe(true)
      expect
        .soft(
          held.map((p) => p.href),
          '(g1) exactly the three links to Home were held',
        )
        .toEqual([home, home, home])
    },
  )

  it.each(ENABLED_LOCALE_CODES)('%s: Grown-ups and the AI voice byline are not held', (locale) => {
    const { header, narration } = renders(locale)
    const grownUps = anchors(header).find((a) => hrefOf(a) === `/${locale}/grown-ups`) ?? ''
    const aiVoice = anchors(narration).find((a) => /\sdata-ai-voice=""/.test(a)) ?? ''
    expect(grownUps, 'precondition: the Grown-ups link rendered').not.toBe('')
    expect(aiVoice, 'precondition: the AI voice link rendered').not.toBe('')
    expect.soft(isHeld(grownUps), '(g2) Grown-ups is plain next/link').toBe(false)
    expect.soft(isHeld(aiVoice), '(g2) the AI voice byline is plain next/link').toBe(false)
    expect
      .soft(
        held.map((p) => p.href).filter((href) => String(href).includes('grown-ups')),
        '(g2) no held link to Grown-ups',
      )
      .toEqual([])
  })
})
