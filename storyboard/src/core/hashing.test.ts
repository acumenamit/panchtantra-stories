import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { jcsBytes, jcsSha256, sha256Hex, toJcs } from './hashing'

describe('hashing', () => {
  it('matches the standard SHA-256 test vector for "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('sorts object keys and drops whitespace (RFC 8785)', () => {
    expect(toJcs({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    )
  })

  it('keeps Devanagari text as UTF-8, not escaped', () => {
    expect(toJcs({ t: 'पञ्चतन्त्र' })).toBe('{"t":"पञ्चतन्त्र"}')
    expect(jcsBytes({ t: 'क' }).length).toBe('{"t":""}'.length + 3)
  })

  it('refuses values JSON cannot represent', () => {
    expect(() => toJcs(undefined)).toThrow(TypeError)
  })

  it('hashes equal objects equally regardless of key order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.dictionary(fc.string(), fc.jsonValue()), async (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse())
        return (await jcsSha256(obj)) === (await jcsSha256(reversed))
      }),
      { seed: 20261021, numRuns: 200 },
    )
  })
})
