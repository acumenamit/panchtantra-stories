// Subscriber calls for the progress code (spec §6.3, §6.4; P1-4a). A subscriber is UI code. Its
// error must not turn a store call into a rejection after the write already happened, stop the
// other subscribers, or make the run controller's dispatch() throw before the tap's synchronous
// audio call (spec §6.4). So each listener runs inside its own try/catch, and what it throws goes
// to an error reporter instead of to the caller.
// - The default reporter rethrows the error in a microtask, so it is still reported (the console
//   and window 'error' in a browser) but only after the current call has finished.
// - A listener that is not a function is a programmer error: subscribe() throws a TypeError at
//   once, before anything is stored or attached.

/** Receives an error a subscriber threw. */
export type ListenerErrorReporter = (error: unknown) => void

/** The default reporter: the error is rethrown after the current call, never into it. */
export function rethrowLater(error: unknown): void {
  queueMicrotask(() => {
    throw error
  })
}

export function assertListener(listener: unknown): asserts listener is () => void {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function')
}

/** Calls every listener once, in subscription order. One that throws does not stop the rest. */
export function callListeners(
  listeners: ReadonlySet<() => void>,
  report: ListenerErrorReporter,
): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      report(error)
    }
  }
}
