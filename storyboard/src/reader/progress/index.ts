// Progress on the device, browser part (spec §6.3; P1-4a). Importing this module touches nothing:
// no storage, no window, no listeners. readerStores() builds the page's stores on first call.
import { createDeviceStorage, type DeviceStorageOptions } from './device-storage'
import { createPrefsStore, type PrefsStore } from './prefs-store'
import { createProgressStore, type ProgressStore } from './progress-store'

export { createDeviceStorage } from './device-storage'
export type {
  DeviceStorage,
  DeviceStorageOptions,
  MemoryReason,
  RecordStatus,
  StorageEventSource,
  StorageMode,
  WebStorageArea,
} from './device-storage'
export { createProgressStore } from './progress-store'
export type { ProgressStore, ProgressStoreOptions } from './progress-store'
export { createPrefsStore } from './prefs-store'
export type { PrefsStore, PrefsStoreOptions } from './prefs-store'
export { createRunController } from './run-controller'
export type { RunController, RunControllerOptions, RunPhase, RunSnapshot } from './run-controller'
export type { ListenerErrorReporter } from './listeners'

export interface ReaderStores {
  readonly progress: ProgressStore
  readonly prefs: PrefsStore
}

export interface ReaderStoresOptions extends DeviceStorageOptions {
  readonly isBrowser?: () => boolean
}

/** One device storage shared by both stores. For tests and for readerStores(). */
export function createReaderStores(options: ReaderStoresOptions = {}): ReaderStores {
  const device = createDeviceStorage(options)
  const { onListenerError } = options
  return {
    progress: createProgressStore({ device, onListenerError }),
    prefs: createPrefsStore({ device, isBrowser: options.isBrowser, onListenerError }),
  }
}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

/**
 * Builds a readerStores(): the stores are created on its first call in the browser and then kept
 * for the page. On the server each call gets its own stores, which touch no storage, so nothing is
 * ever shared between requests. Injectable for tests.
 */
export function createReaderStoresGetter(
  isBrowser: () => boolean = hasWindow,
  create: () => ReaderStores = createReaderStores,
): () => ReaderStores {
  let pageStores: ReaderStores | null = null
  return () => {
    if (!isBrowser()) return create()
    pageStores ??= create()
    return pageStores
  }
}

/** The page's one device storage and both stores, created on the first call. */
export const readerStores: () => ReaderStores = createReaderStoresGetter()
