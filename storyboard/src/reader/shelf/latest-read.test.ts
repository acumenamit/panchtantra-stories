// The latest-read seam (P1 Step 12, design p1-step12-design.md §4.2, §4.5, §13.11 item 5a; test
// plan T12-5). createLatestRead({ read, apply, empty, now }) runs one progress read at a time for
// Home's provider and the landing's actions: one apply per read, a rejection applies `empty`, a
// read that finishes after dispose() or after a newer read applies nothing, and now() is read when
// the read resolves. Every promise here is a deferred one the test settles itself.
import { describe, expect, it } from 'vitest'
import { createLatestRead } from './latest-read'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every settled promise's callbacks run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** A read seam with queued deferred reads, an apply log and a clock the test moves. */
function harness() {
  const reads: Deferred<string>[] = []
  const applied: [string, number][] = []
  let clock = 100
  const latest = createLatestRead<string>({
    read: () => {
      const next = deferred<string>()
      reads.push(next)
      return next.promise
    },
    apply: (value, now) => applied.push([value, now]),
    empty: 'EMPTY',
    now: () => clock,
  })
  return {
    latest,
    reads,
    applied,
    setClock: (value: number) => {
      clock = value
    },
  }
}

describe('createLatestRead (T12-5)', () => {
  it('(g1) one run applies its value and the time once', async () => {
    const h = harness()
    h.latest.run()
    expect(h.reads, 'precondition: one read started').toHaveLength(1)
    h.reads[0]?.resolve('one')
    await flush()
    expect.soft(h.applied, '(g1) applied once').toEqual([['one', 100]])
  })

  it('(g2) a rejected read applies empty', async () => {
    const h = harness()
    h.latest.run()
    h.reads[0]?.reject(new Error('storage'))
    await flush()
    expect.soft(h.applied, '(g2) empty on a rejection').toEqual([['EMPTY', 100]])
  })

  it('(g3) dispose before the read resolves: nothing applied', async () => {
    const h = harness()
    h.latest.run()
    h.latest.dispose()
    h.reads[0]?.resolve('late')
    await flush()
    expect.soft(h.applied, '(g3) nothing after dispose').toEqual([])
  })

  it('(g4) two overlapping runs, the older resolving last: only the newer applies', async () => {
    const h = harness()
    h.latest.run()
    h.latest.run()
    expect(h.reads, 'precondition: two reads started').toHaveLength(2)
    h.reads[1]?.resolve('newer')
    await flush()
    h.reads[0]?.resolve('older')
    await flush()
    expect.soft(h.applied, '(g4) only the newer').toEqual([['newer', 100]])
  })

  it('(g5) now is read when the read resolves, not when it starts', async () => {
    const h = harness()
    h.latest.run()
    h.setClock(250)
    h.reads[0]?.resolve('one')
    await flush()
    expect.soft(h.applied, '(g5) the time at resolve').toEqual([['one', 250]])
  })

  it('a read that throws before it returns a promise counts as a rejection', async () => {
    const applied: unknown[] = []
    const latest = createLatestRead<string>({
      read: () => {
        throw new Error('no storage')
      },
      apply: (value) => applied.push(value),
      empty: 'EMPTY',
      now: () => 0,
    })
    latest.run()
    await flush()
    expect(applied).toEqual(['EMPTY'])
  })
})
