import { describe, expect, it } from 'vitest'
import {
  checkServiceUrl,
  describeNetworkError,
  mediaType,
  parseJsonBytes,
  readCapped,
} from './http'

describe('checkServiceUrl', () => {
  it('accepts https anywhere and plain http on loopback hosts only', () => {
    for (const raw of [
      'https://abcdefghijklmnopqrst.supabase.co',
      'https://api.vercel.com/v1/x?y=1',
      'http://127.0.0.1:4000',
      'http://localhost:4000/a',
      'http://[::1]:4000',
    ]) {
      expect(() => checkServiceUrl(new URL(raw), 'test URL')).not.toThrow()
    }
  })

  it('refuses http elsewhere, other schemes, credentials and fragments, naming only the label', () => {
    const cases: [string, string][] = [
      ['http://example.com', 'test URL must use https'],
      ['ftp://127.0.0.1', 'test URL must use https'],
      ['https://user:pw-value@example.com', 'test URL must not carry credentials'],
      ['https://example.com/#frag-value', 'test URL must not carry a fragment'],
    ]
    for (const [raw, message] of cases) {
      expect(() => checkServiceUrl(new URL(raw), 'test URL')).toThrow(new TypeError(message))
    }
  })
})

describe('describeNetworkError', () => {
  it('keeps the error name and cause code, never the message', () => {
    const error = new TypeError('fetch failed for https://secret.example/token-value', {
      cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
    })
    expect(describeNetworkError(error)).toBe('TypeError (ECONNREFUSED)')
    expect(describeNetworkError(new DOMException('timed out', 'TimeoutError'))).toBe('TimeoutError')
    expect(describeNetworkError('a string')).toBe('network error')
  })
})

describe('readCapped', () => {
  it('reads a body up to the cap', async () => {
    const bytes = await readCapped(new Response('abc'), 3)
    expect(bytes).toEqual(new TextEncoder().encode('abc'))
  })

  it('returns null for a declared or streamed body over the cap', async () => {
    const declared = new Response('abcd', { headers: { 'content-length': '4' } })
    expect(await readCapped(declared, 3)).toBeNull()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2))
        controller.enqueue(new Uint8Array(2))
        controller.close()
      },
    })
    expect(await readCapped(new Response(stream), 3)).toBeNull()
  })

  it('returns an empty array for a response without a body', async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 3)).toEqual(new Uint8Array(0))
  })
})

describe('parseJsonBytes and mediaType', () => {
  it('parses strict UTF-8 JSON only', () => {
    expect(parseJsonBytes(new TextEncoder().encode('{"a":1}'))).toEqual({
      ok: true,
      value: { a: 1 },
    })
    expect(parseJsonBytes(new Uint8Array(0))).toEqual({ ok: false })
    expect(parseJsonBytes(new Uint8Array([0xff, 0x7b, 0x7d]))).toEqual({ ok: false })
  })

  it('drops parameters and lowercases', () => {
    expect(mediaType('Application/JSON; charset=utf-8')).toBe('application/json')
    expect(mediaType(null)).toBe('')
  })
})
