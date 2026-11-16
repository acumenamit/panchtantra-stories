// Share from the ending card (Step 10c; design p1-step10-design.md D11-P14, §9.2 10c rows; spec
// §6.1 player "Share", §6.5). runShare with a fake navigator and a fake status holder: share then
// idle; AbortError idle, silent, no clipboard; any other rejection, no share, no canShare or a
// "no" from canShare fall to the clipboard; a clipboard rejection or no clipboard falls to the
// read-only field; a tap while pending is ignored. share() runs before any await (inside the tap's
// user activation) and as a method of the navigator. A chain that ends after its control left the
// page shows nothing and never reaches the clipboard (review R10c-STRESS-3). shareUrlOf: the
// content locale, built from the origin only (no query, no hash), the player path.
import { describe, expect, it } from 'vitest'
import lanternWalk from '../../../fixtures/packages/lantern-walk.json'
import riverStones from '../../../fixtures/packages/river-stones.json'
import twoPaths from '../../../fixtures/packages/two-paths.json'
import type { LocaleCode } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import {
  runShare,
  shareUrlOf,
  type ShareEnv,
  type ShareNavigator,
  type ShareStatus,
  type ShareTarget,
} from './share'

const TARGET: ShareTarget = {
  title: 'The Lantern Walk',
  url: 'http://127.0.0.1:3005/hi/stories/lantern-walk/read',
}

/** A fake env: every status shown, in order; leave() takes the control off the page. */
function envOf(navigator: ShareNavigator): {
  env: ShareEnv
  shown: ShareStatus[]
  leave: () => void
} {
  let status: ShareStatus = 'idle'
  let alive = true
  const shown: ShareStatus[] = []
  return {
    env: {
      navigator,
      alive: () => alive,
      status: () => status,
      setStatus: (next) => {
        status = next
        shown.push(next)
      },
    },
    shown,
    leave: () => {
      alive = false
    },
  }
}

interface Calls {
  share: ShareTarget[]
  canShare: ShareTarget[]
  writeText: string[]
}

/** A navigator whose share settles as `share` says, and whose clipboard settles as `copy` says. */
function fakeNavigator(
  share: 'resolve' | 'abort' | 'type-error' | 'never' | 'absent',
  copy: 'resolve' | 'reject' | 'absent' | 'no-write-text',
  options: { canShare?: boolean | 'absent' } = {},
): { navigator: ShareNavigator; calls: Calls } {
  const calls: Calls = { share: [], canShare: [], writeText: [] }
  const navigator: {
    share?: (data: ShareTarget) => Promise<void>
    canShare?: (data: ShareTarget) => boolean
    clipboard?: { writeText?: (text: string) => Promise<void> }
  } = {}
  if (share !== 'absent') {
    navigator.share = (data) => {
      calls.share.push(data)
      if (share === 'resolve') return Promise.resolve()
      if (share === 'abort') return Promise.reject(new DOMException('Share canceled', 'AbortError'))
      if (share === 'type-error') return Promise.reject(new TypeError('not allowed'))
      return new Promise<void>(() => {})
    }
  }
  if (options.canShare !== 'absent') {
    const answer = options.canShare !== false
    navigator.canShare = (data) => {
      calls.canShare.push(data)
      return answer
    }
  }
  if (copy === 'no-write-text') navigator.clipboard = {}
  else if (copy !== 'absent') {
    navigator.clipboard = {
      writeText: (text) => {
        calls.writeText.push(text)
        return copy === 'resolve' ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))
      },
    }
  }
  return { navigator, calls }
}

describe('runShare (D11-P14)', () => {
  it('share resolves: pending, then idle; no clipboard', async () => {
    const { navigator, calls } = fakeNavigator('resolve', 'resolve')
    const { env, shown } = envOf(navigator)
    await expect(runShare(env, TARGET)).resolves.toBe('idle')
    expect(shown).toEqual(['pending', 'idle'])
    expect(calls.canShare).toEqual([TARGET])
    expect(calls.share).toEqual([TARGET])
    expect(calls.writeText).toEqual([])
  })

  it('share rejects with AbortError: idle and silent, the clipboard is never tried', async () => {
    const { navigator, calls } = fakeNavigator('abort', 'resolve')
    const { env, shown } = envOf(navigator)
    await expect(runShare(env, TARGET)).resolves.toBe('idle')
    expect(shown).toEqual(['pending', 'idle'])
    expect(calls.share).toHaveLength(1)
    expect(calls.writeText).toEqual([])
    // A plain object named AbortError counts too (feature detection, not instanceof).
    const plain: ShareNavigator = {
      share: () => Promise.reject({ name: 'AbortError' }),
      canShare: () => true,
      clipboard: {
        writeText: () => {
          throw new Error('the clipboard was tried')
        },
      },
    }
    const second = envOf(plain)
    await expect(runShare(second.env, TARGET)).resolves.toBe('idle')
  })

  it('share rejects with TypeError: falls to the clipboard, which copies the URL', async () => {
    const { navigator, calls } = fakeNavigator('type-error', 'resolve')
    const { env, shown } = envOf(navigator)
    await expect(runShare(env, TARGET)).resolves.toBe('copied')
    expect(shown).toEqual(['pending', 'copied'])
    expect(calls.share).toHaveLength(1)
    expect(calls.writeText).toEqual([TARGET.url])
  })

  it('no share, no canShare, or canShare says no: the clipboard, share never called', async () => {
    for (const [name, made] of [
      ['no share', fakeNavigator('absent', 'resolve')],
      ['no canShare', fakeNavigator('resolve', 'resolve', { canShare: 'absent' })],
      ['canShare false', fakeNavigator('resolve', 'resolve', { canShare: false })],
    ] as const) {
      const { env, shown } = envOf(made.navigator)
      await expect(runShare(env, TARGET), name).resolves.toBe('copied')
      expect(shown, name).toEqual(['pending', 'copied'])
      expect(made.calls.share, name).toEqual([])
      expect(made.calls.writeText, name).toEqual([TARGET.url])
    }
  })

  it('a canShare that throws counts as no share', async () => {
    const { calls, navigator } = fakeNavigator('resolve', 'resolve')
    const throwing: ShareNavigator = {
      ...navigator,
      canShare: () => {
        throw new TypeError('bad data')
      },
    }
    const { env } = envOf(throwing)
    await expect(runShare(env, TARGET)).resolves.toBe('copied')
    expect(calls.share).toEqual([])
  })

  it('the clipboard rejects, is absent or has no writeText: the read-only field (manual)', async () => {
    for (const [name, made] of [
      ['share TypeError, copy rejects', fakeNavigator('type-error', 'reject')],
      ['no share, copy rejects', fakeNavigator('absent', 'reject')],
      ['no share, no clipboard', fakeNavigator('absent', 'absent')],
      ['no share, no writeText', fakeNavigator('absent', 'no-write-text')],
    ] as const) {
      const { env, shown } = envOf(made.navigator)
      await expect(runShare(env, TARGET), name).resolves.toBe('manual')
      expect(shown, name).toEqual(['pending', 'manual'])
    }
  })

  it('a tap while pending is ignored: one share call, no status change', async () => {
    const { navigator, calls } = fakeNavigator('never', 'resolve')
    const { env, shown } = envOf(navigator)
    // The first share never settles (a sheet left open); two more taps come while it is pending.
    void runShare(env, TARGET)
    expect(env.status()).toBe('pending')
    const second = runShare(env, TARGET)
    const third = runShare(env, TARGET)
    // Checked synchronously: a second share() call would already have happened.
    expect(calls.share).toEqual([TARGET])
    await expect(second).resolves.toBe('pending')
    await expect(third).resolves.toBe('pending')
    expect(calls.share).toEqual([TARGET])
    expect(calls.writeText).toEqual([])
    expect(shown).toEqual(['pending'])
  })

  it('after a share settles, the next tap runs the chain again', async () => {
    const { navigator, calls } = fakeNavigator('type-error', 'resolve')
    const { env, shown } = envOf(navigator)
    await runShare(env, TARGET)
    await runShare(env, TARGET)
    expect(calls.share).toHaveLength(2)
    expect(calls.writeText).toHaveLength(2)
    expect(shown).toEqual(['pending', 'copied', 'pending', 'copied'])
  })

  it('share() runs before any await (the tap activation) and as a method of the navigator', () => {
    const seen: unknown[] = []
    const navigator: ShareNavigator = {
      canShare: () => true,
      share(this: unknown) {
        seen.push(this)
        return Promise.resolve()
      },
    }
    const { env } = envOf(navigator)
    void runShare(env, TARGET)
    // Synchronously, before the returned promise could have resumed after an await.
    expect(seen).toEqual([navigator])
  })

  it('writeText runs as a method of the clipboard', async () => {
    const seen: unknown[] = []
    const clipboard = {
      writeText(this: unknown) {
        seen.push(this)
        return Promise.resolve()
      },
    }
    const { env } = envOf({ clipboard })
    await expect(runShare(env, TARGET)).resolves.toBe('copied')
    expect(seen).toEqual([clipboard])
  })

  it('the control leaves while a copy runs: the copy ends with nothing shown or announced', async () => {
    const writes: string[] = []
    let copied: () => void = () => undefined
    const { env, shown, leave } = envOf({
      clipboard: {
        writeText: (text) => {
          writes.push(text)
          return new Promise<void>((resolve) => {
            copied = resolve
          })
        },
      },
    })
    const running = runShare(env, TARGET)
    expect(writes).toEqual([TARGET.url])
    // Try another path (or Back, or All stories) while the copy is pending.
    leave()
    copied()
    await running
    expect(shown, 'nothing after pending: no "Link copied."').toEqual(['pending'])
  })

  it('the control leaves while the share sheet is open: a later failure never reaches the clipboard', async () => {
    const writes: string[] = []
    let fail: (error: unknown) => void = () => undefined
    const { env, shown, leave } = envOf({
      canShare: () => true,
      share: () =>
        new Promise<void>((_, reject) => {
          fail = reject
        }),
      clipboard: {
        writeText: (text) => {
          writes.push(text)
          return Promise.resolve()
        },
      },
    })
    const running = runShare(env, TARGET)
    leave()
    fail(new DOMException('Share failed', 'NotAllowedError'))
    await running
    expect(writes, 'the clipboard after the control left').toEqual([])
    expect(shown, 'nothing after pending').toEqual(['pending'])
  })
})

describe('shareUrlOf (D11-P14)', () => {
  const stories = [twoPaths, riverStones, lanternWalk].map((raw) => StoryPackageV1.parse(raw))
  // The page the reader is on: the route locale is en, with a query and a hash.
  const where = {
    origin: 'http://127.0.0.1:3005',
    href: 'http://127.0.0.1:3005/en/stories/two-paths/read?from=shelf#main',
    pathname: '/en/stories/two-paths/read',
    search: '?from=shelf',
    hash: '#main',
  }

  it('is the player URL in the content locale, from the origin only (no query, no hash)', () => {
    const cases = stories.flatMap((pkg) =>
      pkg.locales.map((locale) => [pkg.storyId, locale] as const),
    )
    expect(cases).toHaveLength(6)
    for (const [storyId, locale] of cases) {
      const url = shareUrlOf(where, storyId, locale)
      expect(url).toBe(`http://127.0.0.1:3005/${locale}/stories/${storyId}/read`)
      expect(url).not.toMatch(/[?#]/)
      expect(new URL(url).pathname).toBe(`/${locale}/stories/${storyId}/read`)
    }
  })

  it('takes the content locale, never the page route locale', () => {
    const content: LocaleCode = 'hi'
    expect(shareUrlOf(where, 'two-paths', content)).toBe(
      'http://127.0.0.1:3005/hi/stories/two-paths/read',
    )
    expect(shareUrlOf({ origin: 'https://example.test' }, 'lantern-walk', 'en')).toBe(
      'https://example.test/en/stories/lantern-walk/read',
    )
  })
})
