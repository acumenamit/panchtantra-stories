// zod without its eval probe (spec §9 CSP, §10.2; design p1-step7-design.md §11 R10; P1-1c fix).
// Once src/core/zod-jitless.ts has run, building and parsing a schema never calls the Function
// constructor, which the spec CSP would report as a script-src violation in a browser, and the
// schema modules that reader pages load leave the setting on. (client-boundary.test.ts checks that
// every module under src/ and app/ that loads zod imports zod-jitless first.)
import './zod-jitless'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('zod-jitless', () => {
  it('turns zod’s compiled fast path off', () => {
    expect(z.config().jitless).toBe(true)
  })

  it('then object schemas build and parse without the Function constructor', () => {
    const constructed = vi.spyOn(globalThis, 'Function')
    const Shape = z.strictObject({ id: z.string(), count: z.number().int(), extra: z.object({}) })
    expect(Shape.parse({ id: 'a', count: 1, extra: { x: 1 } })).toEqual({
      id: 'a',
      count: 1,
      extra: {},
    })
    expect(Shape.safeParse({ id: 'a', count: 1.5, extra: {} }).success).toBe(false)
    expect(constructed).not.toHaveBeenCalled()
  })

  it('stays on after the schema modules that reader pages load', async () => {
    await import('./progress/records')
    await import('./package/v1')
    expect(z.config().jitless).toBe(true)
  })
})
