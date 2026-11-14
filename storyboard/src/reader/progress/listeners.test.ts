import { describe, expect, it } from 'vitest'
import { assertListener, callListeners } from './listeners'

describe('callListeners', () => {
  it('calls every listener once, in subscription order', () => {
    const calls: string[] = []
    const listeners = new Set([() => calls.push('a'), () => calls.push('b')])
    callListeners(listeners, () => {
      throw new Error('no error expected')
    })
    expect(calls).toEqual(['a', 'b'])
  })

  it('a listener that throws does not stop the others; each error goes to the reporter', () => {
    const calls: string[] = []
    const errors: unknown[] = []
    const first = new Error('first')
    const third = 'not even an Error'
    const listeners = new Set<() => void>([
      () => {
        throw first
      },
      () => calls.push('second'),
      () => {
        throw third
      },
      () => calls.push('fourth'),
    ])
    expect(() => callListeners(listeners, (error) => errors.push(error))).not.toThrow()
    expect(calls).toEqual(['second', 'fourth'])
    expect(errors).toEqual([first, third])
  })

  it('calls the listeners present when it started, even if one unsubscribes another', () => {
    const calls: string[] = []
    const listeners = new Set<() => void>()
    const b = () => calls.push('b')
    listeners.add(() => {
      calls.push('a')
      listeners.delete(b)
      listeners.add(() => calls.push('late'))
    })
    listeners.add(b)
    callListeners(listeners, () => {})
    expect(calls).toEqual(['a', 'b'])
  })
})

describe('assertListener', () => {
  it('accepts a function and throws a TypeError for anything else', () => {
    expect(() => assertListener(() => {})).not.toThrow()
    for (const bad of [undefined, null, 0, 'f', {}, []]) {
      expect(() => assertListener(bad)).toThrow(TypeError)
    }
  })
})
