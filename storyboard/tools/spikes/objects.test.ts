// P0-13 THROWAWAY: removed at cleanup
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { POINTER_ROOTS } from '../../scripts/load-content'
import { isSafeStoragePath, modeFromPointerPath } from '../../src/core/content/gates'
import { mp3Info } from '../narration/mp3'
import { Secret } from '../publisher/env'
import { createStorageClient } from '../publisher/storage'
import {
  AUDIO_PROBE_PATH,
  AUDIO_SOURCE_DIR,
  audioUploadList,
  cdnProbeList,
  CLIPS,
  clipPath,
  freshnessPointerPath,
  MISSING_CLIP_PATH,
  MP3_FRAME_BYTES,
  probeJpeg,
  probeJson,
  probeWebp,
  publicObjectUrl,
  readClip,
  S1_POINTER,
  s1SnapshotPath,
  sha256Hex,
  spikeGuards,
  syntheticMp3,
  type Clip,
} from './objects'

const RUN = 'r20261107-101500'
let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spike-objects-'))
  tempDirs.push(dir)
  return dir
}

describe('spike paths and guards', () => {
  it('names the S-1 pointer, snapshots, freshness pointer and audio objects under spikes/', () => {
    expect(S1_POINTER).toBe('spikes/s1/catalogue/production.json')
    expect(s1SnapshotPath(3)).toBe('spikes/s1/catalogue/snapshots/3.json')
    expect(freshnessPointerPath(RUN)).toBe(`spikes/s1/freshness/${RUN}/pointer.json`)
    expect(AUDIO_PROBE_PATH).toBe('spikes/audio/probe.webp')
    expect(MISSING_CLIP_PATH).toBe('spikes/audio/missing-on-purpose.mp3')
    const every = [
      S1_POINTER,
      s1SnapshotPath(1),
      freshnessPointerPath(RUN),
      ...audioUploadList().map((o) => o.path),
      ...cdnProbeList(RUN).map((o) => o.path),
    ]
    for (const path of every) {
      expect(isSafeStoragePath(path)).toBe(true)
      expect(path.startsWith('spikes/')).toBe(true)
    }
  })

  it('the loader accepts the S-1 pointer as a production pointer under the spike root', () => {
    expect(modeFromPointerPath(S1_POINTER, POINTER_ROOTS)).toEqual({
      ok: true,
      value: { mode: 'production', root: 'spikes/s1/' },
    })
  })

  it('refuses a malformed run id', () => {
    expect(() => freshnessPointerPath('../x')).toThrow('run id')
    expect(() => probeJson('r1')).toThrow('run id')
  })

  it('guards allow bucket content only, prefix spikes/, and exactly the pointer paths', () => {
    expect(spikeGuards()).toEqual({
      allowedBuckets: ['content'],
      writePrefixes: ['spikes/'],
      overwritablePaths: [S1_POINTER],
    })
    expect(spikeGuards(RUN).overwritablePaths).toEqual([S1_POINTER, freshnessPointerPath(RUN)])
    // The storage module accepts them.
    expect(() =>
      createStorageClient({
        supabaseUrl: new URL('https://abcdefghijklmnopqrst.supabase.co'),
        secretKey: new Secret(['sb', 'secret', 'objects-test'].join('_')),
        guards: spikeGuards(RUN),
        fetchImpl: () => Promise.reject(new Error('no network in tests')),
      }),
    ).not.toThrow()
  })

  it('builds public CDN URLs on the project origin', () => {
    const origin = new URL('https://abcdefghijklmnopqrst.supabase.co')
    expect(publicObjectUrl(origin, AUDIO_PROBE_PATH).href).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/content/spikes/audio/probe.webp',
    )
  })
})

describe('clips', () => {
  it('lists the 4 heard clips with distinct hashes, content-addressed paths and C uploaded last', () => {
    expect(new Set(CLIPS.map((c) => c.sha256)).size).toBe(4)
    const list = audioUploadList()
    expect(list.map((o) => o.path)).toEqual([
      clipPath(CLIPS.find((c) => c.key === 'A')!),
      clipPath(CLIPS.find((c) => c.key === 'B')!),
      clipPath(CLIPS.find((c) => c.key === 'D')!),
      AUDIO_PROBE_PATH,
      clipPath(CLIPS.find((c) => c.key === 'C')!),
    ])
    expect(list.map((o) => o.contentType)).toEqual([
      'audio/mpeg',
      'audio/mpeg',
      'audio/mpeg',
      'image/webp',
      'audio/mpeg',
    ])
    expect(list.every((o) => o.cacheControl === 3600)).toBe(true)
    expect(clipPath(CLIPS.find((c) => c.key === 'C')!)).toBe(
      'spikes/audio/df94e16a29bbe932724c1755945891a0cf2d75504dccedbecc8e87a8e1bb5074.mp3',
    )
  })

  it('readClip returns the bytes only when size and sha256 match', () => {
    const dir = tempDir()
    const bytes = new TextEncoder().encode('clip bytes')
    mkdirSync(join(dir, 'story'), { recursive: true })
    writeFileSync(join(dir, 'story', 'start.en.mp3'), bytes)
    const clip: Clip = {
      key: 'A',
      source: 'story/start.en.mp3',
      sha256: sha256Hex(bytes),
      bytes: bytes.length,
    }
    expect(readClip(clip, dir)).toEqual(new Uint8Array(bytes))
    expect(() => readClip({ ...clip, sha256: 'f'.repeat(64) }, dir)).toThrow('does not match')
    expect(() => readClip({ ...clip, bytes: 1 }, dir)).toThrow('does not match')
  })

  const localClips = existsSync(join(AUDIO_SOURCE_DIR, CLIPS[0]!.source))
  it.skipIf(!localClips)('the local heard files match the recorded size and sha256', () => {
    for (const clip of CLIPS) expect(readClip(clip).byteLength).toBe(clip.bytes)
  })

  it('the clip source folder sits in the gitignored migration-input folder', () => {
    expect(dirname(AUDIO_SOURCE_DIR).endsWith('migration-input')).toBe(true)
  })
})

describe('synthetic probe files', () => {
  it('probe.webp is a 34-byte RIFF/WEBP lossless file', () => {
    const webp = probeWebp()
    expect(webp.byteLength).toBe(34)
    const ascii = (from: number, to: number) => String.fromCharCode(...webp.slice(from, to))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(new DataView(webp.buffer).getUint32(4, true)).toBe(26)
    expect(ascii(8, 16)).toBe('WEBPVP8L')
  })

  it('probe.jpg is a 1x1 baseline JPEG', () => {
    const jpeg = probeJpeg()
    expect(jpeg.byteLength).toBe(631)
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8])
    expect([jpeg.at(-2), jpeg.at(-1)]).toEqual([0xff, 0xd9])
    const sof = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0)
    expect(sof).toBeGreaterThan(0)
    const view = new DataView(jpeg.buffer)
    expect([view.getUint16(sof + 5), view.getUint16(sof + 7)]).toEqual([1, 1])
  })

  it('the synthetic MP3 is just over 16 KiB of valid 128 kbit/s, 48 kHz mono frames', () => {
    const mp3 = syntheticMp3()
    expect(mp3.byteLength).toBe(43 * MP3_FRAME_BYTES)
    expect(mp3.byteLength).toBeGreaterThanOrEqual(16 * 1024)
    const info = mp3Info(mp3)
    expect(info.frames).toBe(43)
    expect(info.kbps).toEqual([128])
    expect(info.sampleRate).toBe(48_000)
    expect(info.mono).toBe(true)
    expect(() => syntheticMp3(0)).toThrow(RangeError)
  })

  it('probe.json is canonical JSON naming the run', () => {
    const text = new TextDecoder().decode(probeJson(RUN))
    expect(text).toBe(`{"probe":"p0-13 cdn","runId":"${RUN}"}`)
  })

  it('the CDN probe set has the planned types and max-age values', () => {
    expect(
      cdnProbeList(RUN).map((o) => [o.path.split('/').at(-1), o.contentType, o.cacheControl]),
    ).toEqual([
      ['probe.json', 'application/json', 3600],
      ['probe.webp', 'image/webp', 3600],
      ['probe.jpg', 'image/jpeg', 3600],
      ['probe-3600.mp3', 'audio/mpeg', 3600],
      ['probe-300.mp3', 'audio/mpeg', 300],
    ])
  })
})
