// ProgressStore (spec §6.3; P1-4a, owner answers 2026-11-14): async, so an IndexedDB or sync
// adapter can replace localStorage later behind the same interface.
// - Every operation re-reads reader.v1.progress, clearAll included, so a stored schema above 1
//   is always found first and left untouched (rollback protection), whatever the call order. A
//   save merges per story: this story's endings are joined with the found one and its run
//   replaces the stored one (the latest run wins); other stories stay exactly as another tab left
//   them. Two tabs saving at the same moment can rarely lose one update (accepted, owner
//   2026-11-14). A "clear progress" in another tab is overwritten for this story by this tab's
//   next save.
// - Reads never write: the cleaned record is saved by the next real save.
// - Storage problems never reject (the device storage falls back to memory). A bad argument, a
//   programmer error, rejects with a TypeError before storage is touched.
// - Subscribers hear, once per call, every change this tab makes and every change of getStatus()
//   (a read can find storage blocked, a newer schema or a reset), plus other tabs' changes. A
//   subscriber that throws never rejects the call or stops the others (listeners.ts).
import { StoryId } from '../../core/package/v1'
import {
  EMPTY_PROGRESS,
  PROGRESS_KEY,
  StepWriteSchema,
  applyStepSave,
  listProgress,
  readProgress,
  removeStory,
  resetRunOf,
  serializeProgress,
  storyProgressOf,
  type ProgressEntry,
  type ProgressRecord,
  type StepWrite,
  type StoryProgress,
} from '../../core/progress'
import type { DeviceStorage, RecordStatus } from './device-storage'
import {
  assertListener,
  callListeners,
  rethrowLater,
  type ListenerErrorReporter,
} from './listeners'

export interface ProgressStore {
  /** The story's progress, or null when nothing is saved for it. */
  get(storyId: string): Promise<StoryProgress | null>
  /** Every story, most recent first (highest order, then storyId). */
  list(): Promise<readonly ProgressEntry[]>
  /** One accepted step's save: the run and a found ending together. */
  saveStep(storyId: string, write: StepWrite): Promise<void>
  /** "Start again": the run becomes null; endings, version and order stay. */
  resetRun(storyId: string): Promise<void>
  /** Removes one story's progress. */
  clearStory(storyId: string): Promise<void>
  /** Removes reader.v1.progress only; prefs stay. A newer schema's bytes are left untouched. */
  clearAll(): Promise<void>
  getStatus(): RecordStatus
  /**
   * This tab's changes, other tabs' changes to reader.v1.progress, and changes of getStatus().
   * A listener that is not a function is a TypeError.
   */
  subscribe(listener: () => void): () => void
}

export interface ProgressStoreOptions {
  readonly device: DeviceStorage
  /** Receives an error a subscriber threw. Defaults to rethrowing it after the current call. */
  readonly onListenerError?: ListenerErrorReporter
}

function assertStoryId(storyId: unknown): asserts storyId is string {
  if (!StoryId.safeParse(storyId).success) throw new TypeError('storyId must be a valid story id')
}

function parseStepWrite(write: unknown): StepWrite {
  const result = StepWriteSchema.safeParse(write)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue === undefined || issue.path.length === 0 ? 'write' : issue.path.join('.')
  throw new TypeError(`invalid step write: ${where}: ${issue?.message ?? 'unknown issue'}`)
}

export function createProgressStore({
  device,
  onListenerError = rethrowLater,
}: ProgressStoreOptions): ProgressStore {
  const listeners = new Set<() => void>()
  let unsubscribeDevice: (() => void) | null = null
  /** The last raw value read (not newer than this code) or written: memory's start if needed. */
  let lastGood: string | null = null

  function notify(): void {
    callListeners(listeners, onListenerError)
  }

  /**
   * Tells subscribers once, after an operation's storage work, when it changed the record or the
   * status. A status object stays the same until the status changes, so identity is enough.
   */
  function settle(statusBefore: RecordStatus, changed: boolean): void {
    if (changed || device.getStatus(PROGRESS_KEY) !== statusBefore) notify()
  }

  function readRecord(): ProgressRecord {
    // At most two reads: after protect() the record comes from memory, never a newer schema.
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = device.read(PROGRESS_KEY)
      const result = readProgress(raw)
      if (result.kind === 'newer-schema') {
        device.protect(PROGRESS_KEY, lastGood)
        continue
      }
      if (raw !== null && result.issues.length > 0) device.noteReset(PROGRESS_KEY, raw)
      lastGood = raw
      return result.record
    }
    return EMPTY_PROGRESS
  }

  function writeRecord(record: ProgressRecord): void {
    const raw = serializeProgress(record)
    device.write(PROGRESS_KEY, raw)
    lastGood = raw
  }

  async function get(storyId: string): Promise<StoryProgress | null> {
    assertStoryId(storyId)
    const statusBefore = device.getStatus(PROGRESS_KEY)
    const story = storyProgressOf(readRecord(), storyId)
    settle(statusBefore, false)
    return story
  }

  async function list(): Promise<readonly ProgressEntry[]> {
    const statusBefore = device.getStatus(PROGRESS_KEY)
    const entries = listProgress(readRecord())
    settle(statusBefore, false)
    return entries
  }

  async function saveStep(storyId: string, write: StepWrite): Promise<void> {
    assertStoryId(storyId)
    const valid = parseStepWrite(write)
    const statusBefore = device.getStatus(PROGRESS_KEY)
    writeRecord(applyStepSave(readRecord(), storyId, valid))
    settle(statusBefore, true)
  }

  async function resetRun(storyId: string): Promise<void> {
    assertStoryId(storyId)
    const statusBefore = device.getStatus(PROGRESS_KEY)
    const record = readRecord()
    const next = resetRunOf(record, storyId)
    if (next !== record) writeRecord(next)
    settle(statusBefore, next !== record)
  }

  async function clearStory(storyId: string): Promise<void> {
    assertStoryId(storyId)
    const statusBefore = device.getStatus(PROGRESS_KEY)
    const record = readRecord()
    const next = removeStory(record, storyId)
    if (next !== record) writeRecord(next)
    settle(statusBefore, next !== record)
  }

  async function clearAll(): Promise<void> {
    const statusBefore = device.getStatus(PROGRESS_KEY)
    // Read first: a newer schema found now is protected, so the remove below only empties memory
    // and the newer bytes stay untouched (rule 9), whether or not a read came before.
    readRecord()
    device.remove(PROGRESS_KEY)
    lastGood = null
    settle(statusBefore, true)
  }

  function subscribe(listener: () => void): () => void {
    assertListener(listener)
    listeners.add(listener)
    unsubscribeDevice ??= device.subscribe(PROGRESS_KEY, notify)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && unsubscribeDevice !== null) {
        unsubscribeDevice()
        unsubscribeDevice = null
      }
    }
  }

  return {
    get,
    list,
    saveStep,
    resetRun,
    clearStory,
    clearAll,
    getStatus: () => device.getStatus(PROGRESS_KEY),
    subscribe,
  }
}
