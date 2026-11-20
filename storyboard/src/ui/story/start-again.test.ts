// Start again on the landing (P1 Step 12, design p1-step12-design.md §3.9 N10, §4.5, §13.11 item
// 5b; test plan T12-8). createStartAgain({ hold, reset, navigate, readUrl }): the navigation hold,
// then the reset (the run cleared, endings kept), then the soft navigation to the player, also
// after a rejected reset; a second call while the first is pending does nothing.
import { describe, expect, it } from 'vitest'
import { createStartAgain } from './start-again'

const READ_URL = '/en/stories/river-stones/read'
const LANDING_URL = '/en/stories/river-stones'

/** A call log and a reset the test settles. */
function harness() {
  const log: string[] = []
  let settle: { resolve: () => void; reject: (e: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  }
  const startAgain = createStartAgain({
    hold: () => log.push('hold'),
    reset: () => {
      log.push('reset')
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      })
    },
    navigate: (url) => log.push(`navigate ${url}`),
    readUrl: READ_URL,
  })
  return { log, startAgain, settle: () => settle }
}

describe('createStartAgain (T12-8)', () => {
  it('(g1) holds, then resets, then navigates, in that order', async () => {
    const h = harness()
    const done = h.startAgain()
    expect
      .soft(h.log, '(g1) hold then reset, no navigation before the reset settles')
      .toEqual(['hold', 'reset'])
    h.settle().resolve()
    await done
    expect.soft(h.log, '(g1) the order').toEqual(['hold', 'reset', `navigate ${READ_URL}`])
  })

  it('(g2) a rejected reset still navigates, once', async () => {
    const h = harness()
    const done = h.startAgain()
    h.settle().reject(new Error('storage'))
    await done.catch(() => {})
    expect
      .soft(h.log, '(g2) navigates after a rejection')
      .toEqual(['hold', 'reset', `navigate ${READ_URL}`])
  })

  it('(g3) a second call while the first is pending does nothing', async () => {
    const h = harness()
    const first = h.startAgain()
    const second = h.startAgain()
    expect.soft(h.log, '(g3) one hold and one reset').toEqual(['hold', 'reset'])
    h.settle().resolve()
    await Promise.all([first, second])
    expect.soft(h.log, '(g3) one navigation').toEqual(['hold', 'reset', `navigate ${READ_URL}`])
  })

  it('(g4) navigates to the read URL, never the landing', async () => {
    const h = harness()
    const done = h.startAgain()
    h.settle().resolve()
    await done
    const navigations = h.log.filter((line) => line.startsWith('navigate '))
    expect.soft(navigations, '(g4) the read URL').toEqual([`navigate ${READ_URL}`])
    expect.soft(navigations, '(g4) not the landing').not.toContain(`navigate ${LANDING_URL}`)
  })
})
