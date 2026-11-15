// Request policy (spec §3.2; design p1-step8-design.md §3.4 rows 1-9 and 36, §4.3, §10.1; P1-2b).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ATTEMPT_TIMEOUT_MS,
  HEAD_CONCURRENCY,
  isRetryableStatus,
  LOAD_DEADLINE_MS,
  MAX_ATTEMPTS,
  MEDIA_DEADLINE_MS,
  MEDIA_FAILURES_MAX,
  parseRetryAfter,
  RETRY_AFTER_MAX_SECONDS,
  RETRY_DELAY_MS,
  retryDecision,
  type AttemptResult,
} from './request-policy'

const response = (status: number, retryAfter: string | null = null): AttemptResult => ({
  kind: 'response',
  status,
  retryAfter,
})
const network = (error: string): AttemptResult => ({ kind: 'network', error })
const STOPPED: AttemptResult = { kind: 'stopped' }

describe('policy values (design §3.4)', () => {
  it('pins the timeout, attempts, delay, Retry-After cap, pool, failure cap and deadlines', () => {
    expect({
      ATTEMPT_TIMEOUT_MS,
      MAX_ATTEMPTS,
      RETRY_DELAY_MS,
      RETRY_AFTER_MAX_SECONDS,
      HEAD_CONCURRENCY,
      MEDIA_FAILURES_MAX,
      MEDIA_DEADLINE_MS,
      LOAD_DEADLINE_MS,
    }).toEqual({
      ATTEMPT_TIMEOUT_MS: 15_000,
      MAX_ATTEMPTS: 3,
      RETRY_DELAY_MS: 1_000,
      RETRY_AFTER_MAX_SECONDS: 10,
      HEAD_CONCURRENCY: 6,
      MEDIA_FAILURES_MAX: 10,
      MEDIA_DEADLINE_MS: 300_000,
      LOAD_DEADLINE_MS: 600_000,
    })
  })
})

describe('parseRetryAfter', () => {
  it.each([
    ['2', 2],
    ['0', 0],
    ['11', 11],
    ['10', 10],
    [' 3 ', 3],
    ['007', 7],
    ['999999999999999', 999_999_999_999_999],
  ])('reads %j as %i seconds', (value, seconds) => {
    expect(parseRetryAfter(value)).toBe(seconds)
  })

  it.each([
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['junk', 'soon'],
    ['a negative number', '-1'],
    ['a fraction', '1.5'],
    ['an exponent', '1e1'],
    ['two values', '2, 3'],
    ['an empty value', ''],
    ['16 digits', '1234567890123456'],
  ])('reads %s as unparseable (null)', (_why, value) => {
    expect(parseRetryAfter(value)).toBeNull()
  })

  it('reads an absent header as null', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
  })
})

describe('isRetryableStatus', () => {
  it('retries 429 and every 5xx, nothing else', () => {
    for (const status of [429, 500, 502, 503, 504, 540, 599])
      expect(isRetryableStatus(status)).toBe(true)
    for (const status of [200, 204, 301, 302, 304, 400, 401, 403, 404, 408, 428, 430, 499, 600]) {
      expect(isRetryableStatus(status)).toBe(false)
    }
  })
})

describe('retryDecision', () => {
  it.each([200, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 404, 410, 600])(
    'uses a %i answer as it is, on every attempt',
    (status) => {
      for (const attempt of [1, 2, 3]) {
        expect(retryDecision(response(status), attempt)).toEqual({ action: 'final' })
      }
    },
  )

  it('ignores Retry-After on an answer that is not retried', () => {
    expect(retryDecision(response(301, '2'), 1)).toEqual({ action: 'final' })
    expect(retryDecision(response(400, '99'), 1)).toEqual({ action: 'final' })
  })

  it.each([429, 500, 503, 599])('retries %i after 1 s, then 2 s, then fails', (status) => {
    expect(retryDecision(response(status), 1)).toEqual({ action: 'retry', delayMs: 1000 })
    expect(retryDecision(response(status), 2)).toEqual({ action: 'retry', delayMs: 2000 })
    expect(retryDecision(response(status), 3)).toEqual({
      action: 'fail',
      reason: `failed after 3 attempts: status ${status}`,
    })
  })

  it.each(['TypeError (ECONNREFUSED)', 'TypeError (UND_ERR_SOCKET)', 'TimeoutError'])(
    'retries a network error or a per-attempt timeout (%s), then fails naming it',
    (error) => {
      expect(retryDecision(network(error), 1)).toEqual({ action: 'retry', delayMs: 1000 })
      expect(retryDecision(network(error), 2)).toEqual({ action: 'retry', delayMs: 2000 })
      expect(retryDecision(network(error), 3)).toEqual({
        action: 'fail',
        reason: `failed after 3 attempts: ${error}`,
      })
    },
  )

  it('never retries once a deadline or the stop signal fired, on any attempt', () => {
    for (const attempt of [1, 2, 3, 4]) {
      expect(retryDecision(STOPPED, attempt)).toEqual({ action: 'stopped' })
    }
  })

  it('waits a Retry-After of 1-10 s instead of the normal delay', () => {
    expect(retryDecision(response(429, '2'), 1)).toEqual({ action: 'retry', delayMs: 2000 })
    expect(retryDecision(response(503, '1'), 2)).toEqual({ action: 'retry', delayMs: 1000 })
    expect(retryDecision(response(429, '10'), 1)).toEqual({ action: 'retry', delayMs: 10_000 })
  })

  it('keeps the normal delay for a Retry-After of 0, a date or junk', () => {
    for (const value of ['0', 'Wed, 21 Oct 2026 07:28:00 GMT', 'soon', '']) {
      expect(retryDecision(response(429, value), 2)).toEqual({ action: 'retry', delayMs: 2000 })
    }
  })

  it('fails at once on a Retry-After above 10 s', () => {
    expect(retryDecision(response(429, '11'), 1)).toEqual({
      action: 'fail',
      reason: 'asked to wait 11 s',
    })
    expect(retryDecision(response(503, '3600'), 2)).toEqual({
      action: 'fail',
      reason: 'asked to wait 3600 s',
    })
  })

  it('names the attempts, not the wait, when the last attempt asks to wait', () => {
    expect(retryDecision(response(503, '11'), 3)).toEqual({
      action: 'fail',
      reason: 'failed after 3 attempts: status 503',
    })
  })

  it('scales the normal delay by the given base, but never a Retry-After', () => {
    expect(retryDecision(response(500), 2, 5)).toEqual({ action: 'retry', delayMs: 10 })
    expect(retryDecision(network('TimeoutError'), 1, 0)).toEqual({ action: 'retry', delayMs: 0 })
    expect(retryDecision(response(429, '2'), 1, 5)).toEqual({ action: 'retry', delayMs: 2000 })
  })

  it('property: at most 3 attempts, and a retry only on 429, 5xx or a network error', () => {
    const results = fc.oneof(
      fc.record({
        kind: fc.constant('response' as const),
        status: fc.integer({ min: 100, max: 699 }),
        retryAfter: fc.oneof(
          fc.constant(null),
          fc.string(),
          fc.integer({ min: 0, max: 40 }).map(String),
        ),
      }),
      fc.record({ kind: fc.constant('network' as const), error: fc.string() }),
      fc.constant({ kind: 'stopped' as const }),
    )
    fc.assert(
      fc.property(results, fc.integer({ min: 1, max: 5 }), (result, attempt) => {
        const d = retryDecision(result, attempt)
        if (d.action !== 'retry') return
        expect(attempt).toBeLessThan(MAX_ATTEMPTS)
        expect(
          result.kind === 'network' ||
            (result.kind === 'response' && isRetryableStatus(result.status)),
        ).toBe(true)
        expect(d.delayMs).toBeGreaterThanOrEqual(1000)
        expect(d.delayMs).toBeLessThanOrEqual(RETRY_AFTER_MAX_SECONDS * 1000)
      }),
      { seed: 20261114, numRuns: 500 },
    )
  })
})
