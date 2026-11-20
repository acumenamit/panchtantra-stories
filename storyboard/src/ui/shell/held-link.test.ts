// HeldLink (P1 Step 12, design p1-step12-design.md §3.13 N14, §4.6; S12-CRIT-1, -12; test plan
// T12-7). next/link with every prop passed through unchanged, plus an onNavigate that starts the
// navigation hold and then calls the caller's onNavigate. It adds no onClick, so a click the
// browser handles itself (a modifier key, another target) holds nothing (link.js:45-81).
// next/link is mocked by a recording component that renders a plain <a>, and ./nav-hold by a
// spy, so the test sees exactly what HeldLink hands to Link and when the hold starts.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, type ComponentProps } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recorded, log } = vi.hoisted(() => ({
  recorded: [] as Record<string, unknown>[],
  log: [] as string[],
}))

vi.mock('next/link', async () => {
  const { createElement: h } = await import('react')
  function RecordingLink(props: Record<string, unknown>) {
    recorded.push(props)
    const { href, children, ...rest } = props
    // next/link reads these two itself; they never reach the <a>.
    delete rest.prefetch
    delete rest.onNavigate
    return h('a', { href, ...rest }, children as never)
  }
  return { default: RecordingLink }
})

vi.mock('./nav-hold', () => ({
  holdNavigation: vi.fn(() => {
    log.push('hold')
  }),
}))

import Link from 'next/link'
import { HeldLink } from './held-link'
import { holdNavigation } from './nav-hold'

const here = dirname(fileURLToPath(import.meta.url))

type LinkProps = ComponentProps<typeof Link>

const PROPS = {
  href: '/en/stories/two-paths/read',
  className: 'x_action',
  prefetch: false,
  'data-story-action': 'start',
  children: 'Start',
} as const

beforeEach(() => {
  recorded.length = 0
  log.length = 0
  vi.mocked(holdNavigation).mockClear()
})

describe('HeldLink (T12-7)', () => {
  it('(g1) passes every prop to Link unchanged and renders Link’s own markup', () => {
    const held = renderToString(createElement(HeldLink, PROPS as unknown as LinkProps))
    expect(recorded, 'precondition: the mock recorded one render').toHaveLength(1)
    const { onNavigate, ...passed } = recorded[0] ?? {}
    expect.soft(passed, '(g1) every prop unchanged').toEqual(PROPS)
    expect.soft(typeof onNavigate, '(g1) onNavigate added').toBe('function')
    const plain = renderToString(createElement(Link, PROPS as unknown as LinkProps))
    expect.soft(held, '(g1) the same markup as Link').toBe(plain)
  })

  it('(g2) onNavigate starts the hold, then calls the caller’s onNavigate, once each', () => {
    const caller = vi.fn(() => {
      log.push('caller')
    })
    renderToString(
      createElement(HeldLink, { ...PROPS, onNavigate: caller } as unknown as LinkProps),
    )
    const onNavigate = recorded[0]?.onNavigate as ((event: unknown) => void) | undefined
    expect(onNavigate, 'precondition: an onNavigate reached Link').toBeTypeOf('function')
    const event = { preventDefault: () => {} }
    onNavigate?.(event)
    expect.soft(log, '(g2) hold, then the caller').toEqual(['hold', 'caller'])
    expect.soft(vi.mocked(holdNavigation), '(g2) hold once').toHaveBeenCalledTimes(1)
    expect.soft(caller, '(g2) caller once, with the event').toHaveBeenCalledWith(event)
    // Without a caller's onNavigate, the hold alone.
    recorded.length = 0
    log.length = 0
    renderToString(createElement(HeldLink, PROPS as unknown as LinkProps))
    ;(recorded[0]?.onNavigate as (event: unknown) => void)(event)
    expect.soft(log, '(g2) the hold alone').toEqual(['hold'])
  })

  it('(g3) adds no onClick: the caller’s, or none', () => {
    renderToString(createElement(HeldLink, PROPS as unknown as LinkProps))
    expect.soft(Object.hasOwn(recorded[0] ?? {}, 'onClick'), '(g3) no onClick added').toBe(false)
    const onClick = vi.fn()
    recorded.length = 0
    renderToString(createElement(HeldLink, { ...PROPS, onClick } as unknown as LinkProps))
    expect.soft(recorded[0]?.onClick, '(g3) the caller’s onClick').toBe(onClick)
    ;(recorded[0]?.onClick as () => void)()
    expect.soft(log, '(g3) a click alone starts no hold').toEqual([])
  })

  it("(g4) the file's first statement is 'use client'", () => {
    const source = readFileSync(join(here, 'held-link.tsx'), 'utf8')
    const rest = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
    expect.soft(rest.startsWith("'use client'"), "(g4) 'use client' first").toBe(true)
  })
})
