// P0-13 THROWAWAY: removed at cleanup
// What the P0-13 spikes upload (plan §3): Storage paths, the 4 heard clips, and the synthetic probe
// files. Everything goes to bucket `content` under `spikes/`; `masters` is never named here.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jcsBytes } from '../../src/core/hashing'
import { pointerPath, snapshotPath } from '../../src/core/package/catalogue-build'
import type { StorageGuards } from '../publisher/storage'

export const STORYBOARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** Gitignored (root .gitignore: /storyboard/migration-input/). Ledger and evidence live here. */
export const SPIKE_DIR = join(STORYBOARD_DIR, 'migration-input', 'spikes', 'p0-13')
export const AUDIO_SOURCE_DIR = join(STORYBOARD_DIR, 'migration-input', 'audio')

export const BUCKET = 'content'
export const WRITE_PREFIX = 'spikes/'
export const S1_ROOT = 'spikes/s1/'
export const S1_POINTER = pointerPath('production', S1_ROOT)
export const AUDIO_PREFIX = 'spikes/audio/'

export const POINTER_CACHE_SECONDS = 0
export const IMMUTABLE_CACHE_SECONDS = 3600
/** The CDN control object (plan S1-7): a shorter max-age tells "follows cacheControl" from "fixed edge TTL". */
export const SHORT_CACHE_SECONDS = 300

export type SpikeContentType = 'application/json' | 'image/webp' | 'image/jpeg' | 'audio/mpeg'

export function s1SnapshotPath(seq: number): string {
  return snapshotPath(seq, S1_ROOT)
}

/** A run id names one freshness or CDN run, so a rerun never reuses a path: r20261107-101500. */
export const RUN_ID_PATTERN = /^r\d{8}-\d{6}(-\d{1,3})?$/

export function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new TypeError('run id must look like r20261107-101500')
}

export function freshnessPointerPath(runId: string): string {
  assertRunId(runId)
  return `${S1_ROOT}freshness/${runId}/pointer.json`
}

/**
 * Storage guards for every spike client: bucket `content` only, writes under `spikes/` only, and the
 * only overwritable paths are the S-1 pointer and (during a freshness run) that run's pointer.
 */
export function spikeGuards(freshnessRunId?: string): StorageGuards {
  const overwritablePaths = [S1_POINTER]
  if (freshnessRunId !== undefined) overwritablePaths.push(freshnessPointerPath(freshnessRunId))
  return { allowedBuckets: [BUCKET], writePrefixes: [WRITE_PREFIX], overwritablePaths }
}

// ---- the 4 heard clips (D3-A; listening-record.json 2026-11-06, hashes match SHA256SUMS.txt) ----

export interface Clip {
  readonly key: 'A' | 'B' | 'C' | 'D'
  /** Relative to migration-input/audio/. */
  readonly source: string
  readonly sha256: string
  readonly bytes: number
}

export const CLIPS: readonly Clip[] = [
  {
    key: 'A',
    source: 'blue-jackal/start.en.mp3',
    sha256: '45866b429e1ba367945166689c72260519bc4b755adc0b6bcd5bf10cc74d1e8c',
    bytes: 393_069,
  },
  {
    key: 'B',
    source: 'blue-jackal/start.hi.mp3',
    sha256: 'ec233a7f8c7dda1d0e311b771139621c979f46515252888da3ebb1fa1ba6734d',
    bytes: 510_285,
  },
  {
    key: 'C',
    source: 'tortoise-and-geese/start.hi.mp3',
    sha256: 'df94e16a29bbe932724c1755945891a0cf2d75504dccedbecc8e87a8e1bb5074',
    bytes: 1_096_653,
  },
  {
    key: 'D',
    source: 'tortoise-and-geese/start.en.mp3',
    sha256: '72009c7e6816b1de4c25144994c33929acf54b43e959969f3c9c046b9b066d54',
    bytes: 796_845,
  },
]

export function clipPath(clip: Clip): string {
  return `${AUDIO_PREFIX}${clip.sha256}.mp3`
}

export const AUDIO_PROBE_PATH = `${AUDIO_PREFIX}probe.webp`
/** Never uploaded: the device page's missing-clip test points here. */
export const MISSING_CLIP_PATH = `${AUDIO_PREFIX}missing-on-purpose.mp3`

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Reads a clip and refuses it unless its size and sha256 match the heard file. */
export function readClip(clip: Clip, audioDir: string = AUDIO_SOURCE_DIR): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(readFileSync(join(audioDir, clip.source)))
  if (bytes.byteLength !== clip.bytes || sha256Hex(bytes) !== clip.sha256) {
    throw new Error(`clip ${clip.key} (${clip.source}) does not match its recorded size and sha256`)
  }
  return bytes
}

// ---- synthetic probe files ----

/** A 1x1 lossless WebP, 34 bytes. */
export const PROBE_WEBP_BASE64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='

/** A 1x1 white baseline JPEG, 631 bytes (encoded locally with GDI+). */
export const PROBE_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q=='

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

export function probeWebp(): Uint8Array<ArrayBuffer> {
  return fromBase64(PROBE_WEBP_BASE64)
}

export function probeJpeg(): Uint8Array<ArrayBuffer> {
  return fromBase64(PROBE_JPEG_BASE64)
}

/** Canonical JSON naming the run, so each run's object has its own bytes. */
export function probeJson(runId: string): Uint8Array<ArrayBuffer> {
  assertRunId(runId)
  return jcsBytes({ probe: 'p0-13 cdn', runId })
}

// MPEG-1 Layer III, 128 kbit/s, 48 kHz, mono, no CRC: 144 * 128000 / 48000 = 384 bytes per frame.
const MP3_FRAME_HEADER = [0xff, 0xfb, 0x94, 0xc0] as const
export const MP3_FRAME_BYTES = 384
export const PROBE_MP3_FRAMES = 43 // 16,512 bytes: just over 16 KiB, about 1 s of silence

/** Silent MP3 frames: a valid header followed by all-zero side info and main data. */
export function syntheticMp3(frames: number = PROBE_MP3_FRAMES): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('frames must be >= 1')
  const bytes = new Uint8Array(frames * MP3_FRAME_BYTES)
  for (let frame = 0; frame < frames; frame++) bytes.set(MP3_FRAME_HEADER, frame * MP3_FRAME_BYTES)
  return bytes
}

// ---- upload lists ----

export type UploadPurpose =
  | 's1-snapshot'
  | 's1-pointer'
  | 'freshness-pointer'
  | 'cdn-probe'
  | 'cdn-reupload'
  | 'audio-clip'
  | 'audio-probe'

export interface SpikeObject {
  readonly path: string
  readonly contentType: SpikeContentType
  readonly cacheControl: number
  readonly purpose: UploadPurpose
  /** Built or read only when the object is about to be uploaded. */
  readonly body: () => Uint8Array<ArrayBuffer>
}

function clipObject(clip: Clip, audioDir?: string): SpikeObject {
  return {
    path: clipPath(clip),
    contentType: 'audio/mpeg',
    cacheControl: IMMUTABLE_CACHE_SECONDS,
    purpose: 'audio-clip',
    body: () => readClip(clip, audioDir),
  }
}

function clipByKey(key: Clip['key']): Clip {
  const clip = CLIPS.find((c) => c.key === key)
  if (!clip) throw new Error(`unknown clip ${key}`)
  return clip
}

/** The fixed `upload` list (plan O4 step 5): clips A, B, D and probe.webp, then clip C last. */
export function audioUploadList(audioDir?: string): readonly SpikeObject[] {
  return [
    clipObject(clipByKey('A'), audioDir),
    clipObject(clipByKey('B'), audioDir),
    clipObject(clipByKey('D'), audioDir),
    {
      path: AUDIO_PROBE_PATH,
      contentType: 'image/webp',
      cacheControl: IMMUTABLE_CACHE_SECONDS,
      purpose: 'audio-probe',
      body: probeWebp,
    },
    clipObject(clipByKey('C'), audioDir),
  ]
}

export type CdnProbeName =
  'probe.json' | 'probe.webp' | 'probe.jpg' | 'probe-3600.mp3' | 'probe-300.mp3'

export const CDN_PROBE_NAMES: readonly CdnProbeName[] = [
  'probe.json',
  'probe.webp',
  'probe.jpg',
  'probe-3600.mp3',
  'probe-300.mp3',
]

export function cdnProbePath(runId: string, name: CdnProbeName): string {
  assertRunId(runId)
  return `${S1_ROOT}cdn/${runId}/${name}`
}

/** The S1-7 probe set for one run (plan §3): JSON, WebP, JPEG and two MP3s with different max-age. */
export function cdnProbeList(runId: string): readonly SpikeObject[] {
  const object = (
    name: CdnProbeName,
    contentType: SpikeContentType,
    cacheControl: number,
    body: () => Uint8Array<ArrayBuffer>,
  ): SpikeObject => ({
    path: cdnProbePath(runId, name),
    contentType,
    cacheControl,
    purpose: 'cdn-probe',
    body,
  })
  return [
    object('probe.json', 'application/json', IMMUTABLE_CACHE_SECONDS, () => probeJson(runId)),
    object('probe.webp', 'image/webp', IMMUTABLE_CACHE_SECONDS, probeWebp),
    object('probe.jpg', 'image/jpeg', IMMUTABLE_CACHE_SECONDS, probeJpeg),
    object('probe-3600.mp3', 'audio/mpeg', IMMUTABLE_CACHE_SECONDS, syntheticMp3),
    object('probe-300.mp3', 'audio/mpeg', SHORT_CACHE_SECONDS, syntheticMp3),
  ]
}

/** The public CDN URL of a `content` object. */
export function publicObjectUrl(supabaseOrigin: URL, path: string): URL {
  return new URL(`/storage/v1/object/public/${BUCKET}/${path}`, supabaseOrigin.origin)
}
