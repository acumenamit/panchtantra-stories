// The media answer (design p1-step11-design.md §13.2 H2, A33, CRIT-1, AUD-3; S10, S11). Once per
// worker and engine, in a separate context that is not the guarded test context, a detached audio
// element's GET of an https URL on a loopback TCP listener (it counts connections and closes each
// at once) is routed and answered with the silent clip. It reports routed, seen, escapes and
// decoded; mediaAllows decides whether a real-element test may run (Chromium only, design §23:
// Linux WebKit answered routed, yet on the site page the guard saw clip requests the media stub
// never answered). A probe request that escapes Playwright's routing reaches only that listener,
// never a real host. Not a spec.
// Its own file (review round 1, S11-R1-FS-2): security-guard.spec.ts needs the answer for G4-G6,
// while e2e/narration-media.ts, which exports the built clip URLs, is held to player-audio.spec.ts
// by the Vitest scan of e2e/ (T11-24). This file exports no clip URL and loads nothing that builds
// one: it takes the clip's bytes from the leaf silent-mp3 module, and the scan holds the clip-path
// builder (scripts/testing/narration-story) out of it, so no re-export through it can reach the
// guard spec (review round 2, S11-R2-FS-1).
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { Browser } from '@playwright/test'
import { silentMp3 } from '../scripts/testing/silent-mp3'

/**
 * The probe clip: the narrated story's clip, 42 silent frames (6,048 bytes; NARRATION_CLIP in
 * scripts/testing/narration-story.ts). The answer asks whether the engine routes and decodes this
 * MP3 format; S5 plays the story's own clip, so a clip that drifted from this one would fail
 * there, not pass unseen.
 */
const PROBE_CLIP = silentMp3(42)

// ---------------------------------------------------------------------------------------------
// H2: the media answer

/** One engine's answer: is a detached audio element's request routed, and does the clip decode? */
export interface MediaAnswer {
  readonly engine: string
  /** The probe's page.route saw the GET. */
  readonly routed: boolean
  /** page.on('request') saw it. */
  readonly seen: boolean
  /** Connections that reached the loopback listener instead (never a real host). */
  readonly escapes: number
  /** The clip reached playing or ended. */
  readonly decoded: boolean
  readonly canPlayType: string
  readonly playOutcome: string
  readonly errorCode: number | null
  readonly ms: number
}

const answers = new Map<string, Promise<MediaAnswer>>()

/** The engine's media answer, asked once per worker and engine (CRIT-1, AUD-3, A33). */
export function mediaAnswerFor(browser: Browser): Promise<MediaAnswer> {
  const engine = `${browser.browserType().name()} ${browser.version()}`
  let answer = answers.get(engine)
  if (answer === undefined) {
    answer = askMedia(browser, engine)
    answers.set(engine, answer)
  }
  return answer
}

/** The probe file's path on the loopback listener. */
export const MEDIA_ANSWER_PATH = '/e2e-media-answer.mp3'

async function askMedia(browser: Browser, engine: string): Promise<MediaAnswer> {
  let escapes = 0
  const listener = createServer((socket) => {
    escapes += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = listener.address() as AddressInfo
  const url = `https://127.0.0.1:${port}${MEDIA_ANSWER_PATH}`
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    let routed = false
    let seen = false
    page.on('request', (request) => {
      if (request.url() === url) seen = true
    })
    await page.route(
      (target) => target.href === url,
      async (route) => {
        routed = true
        await route
          .fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from(PROBE_CLIP) })
          .catch(() => undefined)
      },
    )
    await page.setContent(
      '<!doctype html><title>media answer</title><button type="button">probe</button>',
    )
    await page.evaluate((src) => {
      const w = window as unknown as Record<string, unknown>
      const answer = {
        done: false,
        decoded: false,
        outcome: 'pending',
        code: null as number | null,
        start: 0,
        end: 0,
      }
      w['__e2eAnswer'] = answer
      const button = document.querySelector('button')
      if (button === null) throw new Error('no probe button')
      button.addEventListener('click', () => {
        const audio = document.createElement('audio')
        answer.start = performance.now()
        const finish = (decoded: boolean): void => {
          if (answer.done) return
          answer.done = true
          answer.decoded = decoded
          answer.code = audio.error === null ? null : audio.error.code
          answer.end = performance.now()
        }
        audio.addEventListener('playing', () => finish(true))
        audio.addEventListener('ended', () => finish(true))
        audio.addEventListener('error', () => finish(false))
        audio.preload = 'none'
        audio.src = src
        w['__e2eAnswerAudio'] = audio
        audio.play().then(
          () => {
            answer.outcome = 'resolved'
          },
          (error: unknown) => {
            answer.outcome = error instanceof DOMException ? error.name : String(error)
          },
        )
      })
    }, url)
    await page.click('button')
    await page
      .waitForFunction(
        () => (window as unknown as { __e2eAnswer: { done: boolean } }).__e2eAnswer.done,
        null,
        {
          timeout: 6000,
        },
      )
      .catch(() => undefined)
    const result = await page.evaluate(() => {
      const answer = (window as unknown as Record<string, unknown>)['__e2eAnswer'] as {
        decoded: boolean
        outcome: string
        code: number | null
        start: number
        end: number
      }
      return {
        decoded: answer.decoded,
        outcome: answer.outcome,
        code: answer.code,
        ms: Math.round((answer.end || performance.now()) - answer.start),
        canPlayType: document.createElement('audio').canPlayType('audio/mpeg'),
      }
    })
    return {
      engine,
      routed,
      seen,
      escapes,
      decoded: result.decoded,
      canPlayType: result.canPlayType,
      playOutcome: result.outcome,
      errorCode: result.code,
      ms: result.ms,
    }
  } finally {
    await context.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }
}

/**
 * Whether a real-element test may run on this engine (A33): 'routed' (SPY, G4-G6) needs the
 * engine's media requests routed with no escape; 'decoded' (NETWORK, S5) also needs the clip to
 * decode. Only Chromium may run one (design §23): on Linux WebKit (CI run 44604741639) this probe
 * answered routed with no escape, yet for each clip load on the site page the guard saw a request
 * the media stub never answered, so a WebKit answer is not trusted on any platform.
 */
export function mediaAllows(
  answer: Pick<MediaAnswer, 'engine' | 'routed' | 'escapes' | 'decoded'>,
  need: 'routed' | 'decoded',
): boolean {
  if (!answer.engine.startsWith('chromium ')) return false
  const routed = answer.routed && answer.escapes === 0
  return need === 'routed' ? routed : routed && answer.decoded
}

/** The skip reason a real-element test names: the browser's answer. */
export function mediaAnswerText(answer: MediaAnswer): string {
  const rule = answer.engine.startsWith('chromium ')
    ? ''
    : ' (only Chromium runs a real element, design §23)'
  return `media answer${rule}: ${JSON.stringify(answer)}`
}
