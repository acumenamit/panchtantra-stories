// The media binder's WebP encoder (design migration-input/p1-step17-design.md D17-8, D17-9, §3.8,
// §3.9, A13; P1-9a, Step 17). The only module that names the image package (T17-11): it is loaded
// at run time from Next.js's own dependency (createRequire anchored at next's package.json; under
// pnpm the package is not resolvable from tools/), so no package or lockfile changes. Only the
// binder's CLI and the PC-only codec test call loadSharpCodec; every other test injects a fake
// ImageCodec.
// - Settings (WEBP_SETTINGS, recorded in the ledger and the image log): one thread, no cache; the
//   input fails on an error, at most 4096 x 4096 pixels, read sequentially; a Lanczos 3 resize only
//   when the asked width is below the master's own (never an upscale; at the master's width no
//   resize is made); lossy WebP at quality 80, effort 6, no smart subsampling.
// - No rotation (no rotate() or auto-orient) and no metadata (no withMetadata, keepMetadata or
//   keepIccProfile): a variant holds one `VP8 ` chunk (webp-facts proves it per variant).
// - The versions are reported, never judged here: the binder compares them with EXPECTED_ENCODER
//   before any encode (`encoder-version`).
import { createRequire } from 'node:module'

/** The package id, named once (T17-11 scans for any other literal). */
const SHARP_ID = 'sharp'

/** The encoder versions the variants were made and pinned with (probe P4). */
export const EXPECTED_ENCODER = { sharp: '0.35.5', vips: '8.18.7', webp: '1.6.0' } as const

/** The encoder settings (§3.9); sha256(jcsBytes(WEBP_SETTINGS)) is the ledger's settingsSha256. */
export const WEBP_SETTINGS = {
  concurrency: 1,
  cache: false,
  input: { failOn: 'error', limitInputPixels: 4096 * 4096, sequentialRead: true },
  resize: { kernel: 'lanczos3', withoutEnlargement: true },
  webp: { quality: 80, effort: 6, smartSubsample: false },
} as const

export interface EncoderVersions {
  readonly sharp: string
  readonly vips: string
  readonly webp: string
}

/** Encodes one WebP variant of a master at a width (the master's own width or below). */
export interface ImageCodec {
  readonly versions: EncoderVersions
  encode(master: Uint8Array, width: number): Promise<Uint8Array<ArrayBuffer>>
}

/** The part of the package's API this module uses (no type import: tsc cannot resolve the package). */
interface SharpPipeline {
  metadata(): Promise<{ readonly width?: number; readonly height?: number }>
  resize(options: { readonly width: number } & typeof WEBP_SETTINGS.resize): SharpPipeline
  webp(options: typeof WEBP_SETTINGS.webp): SharpPipeline
  toBuffer(): Promise<Buffer>
}
interface SharpFactory {
  (input: Uint8Array, options: typeof WEBP_SETTINGS.input): SharpPipeline
  readonly versions: Readonly<Record<string, string | undefined>>
  concurrency(threads: number): number
  cache(options: boolean): unknown
}

/**
 * Loads the image package from next's own dependency and returns the codec. Throws when the
 * package cannot be loaded (the binder reports `encoder-unavailable`).
 */
export function loadSharpCodec(): ImageCodec {
  const nextPackage = createRequire(import.meta.url).resolve('next/package.json')
  const sharp = createRequire(nextPackage)(SHARP_ID) as SharpFactory
  sharp.concurrency(WEBP_SETTINGS.concurrency)
  sharp.cache(WEBP_SETTINGS.cache)
  const versions: EncoderVersions = {
    sharp: String(sharp.versions.sharp),
    vips: String(sharp.versions.vips),
    webp: String(sharp.versions.webp),
  }
  return {
    versions,
    async encode(master, width) {
      if (!Number.isSafeInteger(width) || width < 1) throw new TypeError('width must be >= 1')
      const pipeline = sharp(master, WEBP_SETTINGS.input)
      const own = (await pipeline.metadata()).width
      if (own === undefined) throw new TypeError('the master has no width')
      const sized = width < own ? pipeline.resize({ width, ...WEBP_SETTINGS.resize }) : pipeline
      return new Uint8Array(await sized.webp(WEBP_SETTINGS.webp).toBuffer())
    },
  }
}
