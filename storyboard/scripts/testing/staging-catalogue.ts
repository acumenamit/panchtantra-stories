// The 3 committed synthetic fixtures as a staging catalogue on the local Storage stub, for tests and
// the staging harness only (design p1-step9-design.md §2, §3.6 row 29, §6.8; P1-2c). Built with the
// catalogue builders of src/core/package/catalogue-build, at the spec's Storage layout:
//   packages/<storyId>/<sha256>.json   each fixture package as canonical JCS bytes
//   catalogue/snapshots/1.json         the snapshot (seq 1, fixed timestamps, no approvals)
//   catalogue/staging.json             the staging pointer
// The fixtures declare no media, so a load of them alone makes no HEAD request. load-content.test.ts
// keeps its own publish and servePackage helpers, which carry test-only knobs (design §3.6 row 29).
// P1-4b (design p1-step10-design.md §2.5, §4.5, L7, O2; Step 10e): with `pictureStory: true` (only
// scripts/testing/staging-build.ts passes it) the catalogue also holds a test-only picture story
// derived in memory from the river-stones fixture (pictureStoryOf), and the stub serves its 12
// media variants, so the loader's media HEAD gate makes 12 HEAD requests:
//   media/<PICTURE_STORY_ID>/<64 hex>-w<width>.webp   the 34-byte 1×1 WebP, image/webp
// No file under fixtures/ changes and no word is written: the derived story repeats the fixture's
// own Hindi flat_stones passage and copies every other text as stored.
// P1-5a (design p1-step11-design.md §3.23 N23, §8.1; Step 11): with `narrationStory: true` the
// catalogue also holds a test-only narrated story derived from river-stones (narratedStoryOf: the
// fixture as stored plus 15 audio assets, scripts/testing/narration-story.ts), right after the
// picture story, and the stub serves its 15 clips, so the loader makes 15 more HEAD requests:
//   media/<NARRATION_STORY_ID>/<64 hex>-audio.mp3     the 6,048-byte silent MP3, audio/mpeg
// Each variant is served with the stub bytes of its declared mime (mediaOf).
// P1-3 (design p1-step12-design.md §3.17 N18, A19; Step 12a): with `featuredStory: true` the
// catalogue also holds a test-only featured story derived from river-stones (featuredStoryOf: the
// fixture as stored plus a picture on every node and a clip for every node in en and hi), right
// after the narrated story, and the snapshot's featuredStoryId names it, so the featured rule
// (src/core/content/featured.ts: no A001, A005 or A006 error under --feature) keeps it and the
// staging Home shows the hero. The stub serves its 32 media objects (16 WebP, 16 MP3):
//   media/<FEATURED_STORY_ID>/<64 hex>-w<width>.webp and <64 hex>-audio.mp3
// The fixture's texts are copied as stored; no word is written.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SnapshotEntry } from '../../src/core/content/packages'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import {
  makePointer,
  makeSnapshot,
  pointerPath,
  snapshotPath,
} from '../../src/core/package/catalogue-build'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { FIXTURES_SEQ, FIXTURES_TIMESTAMP } from '../build-fixtures-catalogue'
import {
  NARRATION_CLIP,
  NARRATION_CLIP_TYPE,
  NARRATION_CLIPS,
  NARRATION_DURATION_MS,
  NARRATION_NODES,
  narratedTextSha256Of,
  narrationAssetId,
  narrationClipPath,
} from './narration-story'
import { FEATURED_STORY_ID } from './featured-story-id'
import { NARRATION_STORY_ID } from './narration-story-id'
import { PICTURE_STORY_ID } from './picture-story-id'
import type { StubStorage } from './stub-storage'

/** The committed fixtures folder (storyboard/fixtures). */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')

/** The staging pointer the harness loads: catalogue/staging.json (pointer root ''). */
export const STAGING_POINTER_PATH = pointerPath('staging')

export const STAGING_NOTE =
  'Synthetic fixtures as a staging catalogue for the stub harness; scripts/testing/staging-catalogue.ts'

const JSON_TYPE = 'application/json'

/** One published package: its snapshot entry and the exact bytes the stub serves. */
export interface StagingPackage {
  readonly entry: SnapshotEntry
  readonly bytes: Uint8Array<ArrayBuffer>
}

/** One media object the stub serves: a declared variant of a derived story. */
export interface StagingMedia {
  readonly path: string
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly contentType: string
}

export interface StagingCatalogue {
  readonly pointerPath: string
  readonly snapshotPath: string
  readonly pointerBytes: Uint8Array<ArrayBuffer>
  readonly snapshotBytes: Uint8Array<ArrayBuffer>
  /**
   * In snapshot order (file name order; the picture story, then the narrated story, then the
   * featured story, right after their fixture).
   */
  readonly packages: readonly StagingPackage[]
  /** The derived stories' variants, in snapshot then declaration order; empty with no option. */
  readonly media: readonly StagingMedia[]
}

export interface StagingOptions {
  /** Adds the derived picture story and its media (design p1-step10-design.md §4.5). */
  readonly pictureStory?: boolean
  /** Adds the derived narrated story and its 15 clips (design p1-step11-design.md §8.1). */
  readonly narrationStory?: boolean
  /**
   * Adds the derived featured story and its 32 media objects, and names it the snapshot's
   * featuredStoryId (design p1-step12-design.md §3.17).
   */
  readonly featuredStory?: boolean
}

// ---------------------------------------------------------------------------------------------
// The derived picture story (design p1-step10-design.md §4.5, O2)

/** The fixture the picture story is derived from. */
export const PICTURE_SOURCE_ID = 'river-stones'

/** One 34-byte 1×1 lossless WebP: the stub serves it for every variant path. */
export const PICTURE_WEBP: Uint8Array<ArrayBuffer> = Uint8Array.from(
  Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'),
)

export const PICTURE_WEBP_TYPE = 'image/webp' as const

/** A picture's size and its WebP variant widths, smallest first. */
export interface PictureShape {
  readonly width: number
  readonly height: number
  readonly variantWidths: readonly number[]
}

/** The 1408×768 shape of most masters. */
export const WIDE_PICTURE: PictureShape = { width: 1408, height: 768, variantWidths: [768, 1408] }

/** The 1024×1024 shape of the 33 square masters (SPEC:486; design C17). */
export const SQUARE_PICTURE: PictureShape = {
  width: 1024,
  height: 1024,
  variantWidths: [768, 1024],
}

/** The nodes that get a picture, in node order; big_rock and ending_back keep `image: null`. */
export const PICTURE_NODES: Readonly<Record<string, PictureShape>> = {
  start: WIDE_PICTURE,
  flat_stones: WIDE_PICTURE,
  far_bank: SQUARE_PICTURE,
  round_stones: WIDE_PICTURE,
  ending_dry: WIDE_PICTURE,
  ending_wet: WIDE_PICTURE,
}

/** The one lengthened passage: Hindi only (a repeated English passage is an E004 error, O2). */
export const LONG_PASSAGE = { locale: 'hi', nodeId: 'flat_stones' } as const

/** The long passage has at least this many characters (UTF-16 code units, as `length`). */
export const LONG_PASSAGE_MIN = 3600

/** The picture's asset id: sha256 hex of `<PICTURE_STORY_ID>:<nodeId>`. */
export function pictureAssetId(nodeId: string): string {
  return createHash('sha256').update(`${PICTURE_STORY_ID}:${nodeId}`).digest('hex')
}

/** A variant's Storage path (the media path rule, src/core/content/media.ts). */
export function pictureVariantPath(assetId: string, width: number): string {
  return `media/${PICTURE_STORY_ID}/${assetId}-w${width}.webp`
}

/** `text` repeated, joined by a blank line, until it has at least LONG_PASSAGE_MIN characters. */
export function longPassageOf(text: string): string {
  if (text.length === 0) throw new Error('staging: the long passage needs a non-empty passage')
  let long = text
  while (long.length < LONG_PASSAGE_MIN) long += `\n\n${text}`
  return long
}

/**
 * The test-only picture story (design §4.5, O2): the river-stones fixture under PICTURE_STORY_ID,
 * every field as stored except: image assets on the PICTURE_NODES (each a WebP variant per width,
 * 34 bytes, provenance `{ origin: 'unknown' }`: hand-made stubs, not AI-made, so aiUse stays as
 * stored), those nodes' `image`, and the hi flat_stones passage made long by repeating itself.
 * Every English text stays as stored.
 */
export function pictureStoryOf(source: StoryPackageV1): StoryPackageV1 {
  if (source.storyId !== PICTURE_SOURCE_ID) {
    throw new Error(`staging: the picture story derives from ${PICTURE_SOURCE_ID} only`)
  }
  const pkg = structuredClone(source)
  const nodeIds = new Set(pkg.nodes.map((node) => node.id))
  const assets: StoryPackageV1['assets'][number][] = []
  for (const [nodeId, shape] of Object.entries(PICTURE_NODES)) {
    if (!nodeIds.has(nodeId)) throw new Error(`staging: ${PICTURE_SOURCE_ID} has no node ${nodeId}`)
    const id = pictureAssetId(nodeId)
    assets.push({
      kind: 'image',
      id,
      width: shape.width,
      height: shape.height,
      variants: shape.variantWidths.map((width) => ({
        path: pictureVariantPath(id, width),
        mime: PICTURE_WEBP_TYPE,
        bytes: PICTURE_WEBP.length,
        width,
      })),
      provenance: { origin: 'unknown' },
    })
  }
  const passage = pkg.text[LONG_PASSAGE.locale]?.nodes[LONG_PASSAGE.nodeId]
  if (!passage) {
    throw new Error(`staging: ${PICTURE_SOURCE_ID} has no ${LONG_PASSAGE.locale} passage`)
  }
  passage.text = longPassageOf(passage.text)
  return {
    ...pkg,
    storyId: PICTURE_STORY_ID,
    nodes: pkg.nodes.map((node) => ({
      ...node,
      image: Object.hasOwn(PICTURE_NODES, node.id) ? pictureAssetId(node.id) : null,
    })),
    assets: [...pkg.assets, ...assets],
  }
}

// ---------------------------------------------------------------------------------------------
// The derived narrated story (design p1-step11-design.md §3.23 N23, §8.1)

/** The fixture the narrated story is derived from. */
export const NARRATION_SOURCE_ID = 'river-stones'

/**
 * The test-only narrated story (design §3.23): the river-stones fixture under NARRATION_STORY_ID,
 * every field as stored (texts, aiUse, images: none) plus one audio asset per clip of
 * NARRATION_CLIPS (every node in en and hi but big_rock in hi): one variant, the 42-frame silent
 * MP3, provenance `{ origin: 'unknown' }` (code-made stubs, not AI-made, so aiUse stays as stored
 * and the validator raises no A009).
 */
export function narratedStoryOf(source: StoryPackageV1): StoryPackageV1 {
  if (source.storyId !== NARRATION_SOURCE_ID) {
    throw new Error(`staging: the narrated story derives from ${NARRATION_SOURCE_ID} only`)
  }
  const pkg = structuredClone(source)
  if (pkg.nodes.map((node) => node.id).join() !== NARRATION_NODES.join()) {
    throw new Error(`staging: ${NARRATION_SOURCE_ID} no longer has the narrated story's nodes`)
  }
  const assets: StoryPackageV1['assets'][number][] = NARRATION_CLIPS.map(({ nodeId, locale }) => ({
    kind: 'audio',
    id: narrationAssetId(nodeId, locale),
    nodeId,
    locale,
    durationMs: NARRATION_DURATION_MS,
    variants: [
      {
        path: narrationClipPath(nodeId, locale),
        mime: NARRATION_CLIP_TYPE,
        bytes: NARRATION_CLIP.length,
      },
    ],
    provenance: { origin: 'unknown' },
    narratedTextSha256: narratedTextSha256Of(nodeId, locale),
  }))
  return { ...pkg, storyId: NARRATION_STORY_ID, assets: [...pkg.assets, ...assets] }
}

// ---------------------------------------------------------------------------------------------
// The derived featured story (design p1-step12-design.md §3.17 N18, A19)

/** The fixture the featured story is derived from. */
export const FEATURED_SOURCE_ID = 'river-stones'

/** The featured story's picture on every node: the picture story's shapes, the rest wide. */
export const FEATURED_PICTURE_NODES: Readonly<Record<string, PictureShape>> = {
  start: WIDE_PICTURE,
  flat_stones: WIDE_PICTURE,
  big_rock: WIDE_PICTURE,
  far_bank: SQUARE_PICTURE,
  round_stones: WIDE_PICTURE,
  ending_dry: WIDE_PICTURE,
  ending_wet: WIDE_PICTURE,
  ending_back: WIDE_PICTURE,
}

const sha256Of = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * The test-only featured story (design §3.17): the river-stones fixture under FEATURED_STORY_ID,
 * every field as stored (texts, aiUse) except each node's `image` and the assets: a picture on
 * every node of FEATURED_PICTURE_NODES (each a WebP variant per width, asset id the sha256 hex of
 * `<id>:<nodeId>`) and a clip for every node in en and hi (one variant of the silent MP3, asset id
 * the sha256 hex of `<id>:<nodeId>:<locale>:audio`, narratedTextSha256 that of
 * `<id>:<nodeId>:<locale>`), all with provenance `{ origin: 'unknown' }` (code-made stubs, so aiUse
 * stays as stored). So A001, A005 and A006 find nothing under --feature and the featured rule keeps
 * it (src/core/content/featured.ts).
 */
export function featuredStoryOf(source: StoryPackageV1): StoryPackageV1 {
  if (source.storyId !== FEATURED_SOURCE_ID) {
    throw new Error(`staging: the featured story derives from ${FEATURED_SOURCE_ID} only`)
  }
  const pkg = structuredClone(source)
  const nodeIds = pkg.nodes.map((node) => node.id)
  if (nodeIds.join() !== Object.keys(FEATURED_PICTURE_NODES).join()) {
    throw new Error(`staging: ${FEATURED_SOURCE_ID} no longer has the featured story's nodes`)
  }
  const imageId = (nodeId: string): string => sha256Of(`${FEATURED_STORY_ID}:${nodeId}`)
  const images: StoryPackageV1['assets'][number][] = nodeIds.map((nodeId) => {
    const shape = FEATURED_PICTURE_NODES[nodeId] ?? WIDE_PICTURE
    const id = imageId(nodeId)
    return {
      kind: 'image',
      id,
      width: shape.width,
      height: shape.height,
      variants: shape.variantWidths.map((width) => ({
        path: `media/${FEATURED_STORY_ID}/${id}-w${width}.webp`,
        mime: PICTURE_WEBP_TYPE,
        bytes: PICTURE_WEBP.length,
        width,
      })),
      provenance: { origin: 'unknown' },
    }
  })
  const clips: StoryPackageV1['assets'][number][] = nodeIds.flatMap((nodeId) =>
    pkg.locales.map((locale) => {
      const id = sha256Of(`${FEATURED_STORY_ID}:${nodeId}:${locale}:audio`)
      return {
        kind: 'audio' as const,
        id,
        nodeId,
        locale,
        durationMs: NARRATION_DURATION_MS,
        variants: [
          {
            path: `media/${FEATURED_STORY_ID}/${id}-audio.mp3`,
            mime: NARRATION_CLIP_TYPE,
            bytes: NARRATION_CLIP.length,
          },
        ],
        provenance: { origin: 'unknown' as const },
        narratedTextSha256: sha256Of(`${FEATURED_STORY_ID}:${nodeId}:${locale}`),
      }
    }),
  )
  return {
    ...pkg,
    storyId: FEATURED_STORY_ID,
    nodes: pkg.nodes.map((node) => ({ ...node, image: imageId(node.id) })),
    assets: [...pkg.assets, ...images, ...clips],
  }
}

/** The stub bytes of each mime a derived story declares: the 1×1 WebP and the silent MP3. */
const STUB_BYTES: Readonly<Partial<Record<string, Uint8Array<ArrayBuffer>>>> = {
  [PICTURE_WEBP_TYPE]: PICTURE_WEBP,
  [NARRATION_CLIP_TYPE]: NARRATION_CLIP,
}

/**
 * The media objects the stub serves for a package: every declared variant, in order, with the
 * stub bytes of its declared mime and that mime as its content type.
 */
export function mediaOf(pkg: Pick<StoryPackageV1, 'storyId' | 'assets'>): StagingMedia[] {
  return pkg.assets.flatMap((asset) =>
    asset.variants.map((variant) => {
      const bytes = STUB_BYTES[variant.mime]
      if (bytes === undefined) {
        throw new Error(`staging: no stub bytes for ${variant.mime} (${pkg.storyId})`)
      }
      return { path: variant.path, bytes, contentType: variant.mime }
    }),
  )
}

// ---------------------------------------------------------------------------------------------
// The catalogue

/** One package as the stub serves it: canonical JCS bytes, named by their sha256. */
async function stagingPackageOf(raw: unknown): Promise<{ pkg: StoryPackageV1 } & StagingPackage> {
  const pkg = StoryPackageV1.parse(raw)
  const bytes = jcsBytes(raw)
  const packageSha256 = await sha256Hex(bytes)
  return {
    pkg,
    entry: {
      storyId: pkg.storyId,
      collectionId: pkg.collectionId,
      version: pkg.version,
      packagePath: `packages/${pkg.storyId}/${packageSha256}.json`,
      packageSha256,
    },
    bytes,
  }
}

/**
 * Each fixtures/packages/*.json, sorted by file name, strict-parsed and re-serialized as canonical
 * JCS (the committed files are not canonical), named by sha256 of those bytes. With
 * `pictureStory`, the derived picture story follows river-stones (storyId order); with
 * `narrationStory`, the derived narrated story follows them (design p1-step11-design.md §8.1).
 */
export async function stagingPackages(
  fixturesDir = FIXTURES_DIR,
  options: StagingOptions = {},
): Promise<StagingPackage[]> {
  return (await stagingPackagesWithMedia(fixturesDir, options)).packages
}

async function stagingPackagesWithMedia(
  fixturesDir: string,
  options: StagingOptions,
): Promise<{ packages: StagingPackage[]; media: StagingMedia[] }> {
  const dir = join(fixturesDir, 'packages')
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const packages: StagingPackage[] = []
  const media: StagingMedia[] = []
  const derived: string[] = []
  for (const name of names) {
    const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    const { pkg, entry, bytes } = await stagingPackageOf(raw)
    packages.push({ entry, bytes })
    if (options.pictureStory === true && pkg.storyId === PICTURE_SOURCE_ID) {
      const picture = await stagingPackageOf(pictureStoryOf(pkg))
      packages.push({ entry: picture.entry, bytes: picture.bytes })
      media.push(...mediaOf(picture.pkg))
      derived.push(PICTURE_STORY_ID)
    }
    if (options.narrationStory === true && pkg.storyId === NARRATION_SOURCE_ID) {
      const narrated = await stagingPackageOf(narratedStoryOf(pkg))
      packages.push({ entry: narrated.entry, bytes: narrated.bytes })
      media.push(...mediaOf(narrated.pkg))
      derived.push(NARRATION_STORY_ID)
    }
    if (options.featuredStory === true && pkg.storyId === FEATURED_SOURCE_ID) {
      const featured = await stagingPackageOf(featuredStoryOf(pkg))
      packages.push({ entry: featured.entry, bytes: featured.bytes })
      media.push(...mediaOf(featured.pkg))
      derived.push(FEATURED_STORY_ID)
    }
  }
  if (options.pictureStory === true && !derived.includes(PICTURE_STORY_ID)) {
    throw new Error(`staging: the picture story needs the fixture ${PICTURE_SOURCE_ID}`)
  }
  if (options.narrationStory === true && !derived.includes(NARRATION_STORY_ID)) {
    throw new Error(`staging: the narrated story needs the fixture ${NARRATION_SOURCE_ID}`)
  }
  if (options.featuredStory === true && !derived.includes(FEATURED_STORY_ID)) {
    throw new Error(`staging: the featured story needs the fixture ${FEATURED_SOURCE_ID}`)
  }
  return { packages, media }
}

/**
 * Publishes the committed fixtures to `stub` as a staging catalogue: every package, the media
 * (with `pictureStory`, `narrationStory` or `featuredStory`), the snapshot (seq 1, no
 * approvalSha256: staging skips the approval gate; featuredStoryId the featured story with
 * `featuredStory`, else null) and, last, the pointer catalogue/staging.json. Same packages, same
 * bytes.
 */
export async function publishFixturesAsStaging(
  stub: Pick<StubStorage, 'put'>,
  fixturesDir = FIXTURES_DIR,
  options: StagingOptions = {},
): Promise<StagingCatalogue> {
  const { packages, media } = await stagingPackagesWithMedia(fixturesDir, options)
  const snapshot = await makeSnapshot({
    schemaVersion: '1.0',
    seq: FIXTURES_SEQ,
    createdAt: FIXTURES_TIMESTAMP,
    note: STAGING_NOTE,
    featuredStoryId: options.featuredStory === true ? FEATURED_STORY_ID : null,
    stories: packages.map((p) => p.entry),
  })
  const sPath = snapshotPath(FIXTURES_SEQ)
  const pointer = await makePointer({
    schemaVersion: '1.0',
    seq: FIXTURES_SEQ,
    snapshotPath: sPath,
    snapshotSha256: snapshot.sha256,
    updatedAt: FIXTURES_TIMESTAMP,
  })
  for (const { entry, bytes } of packages) stub.put(entry.packagePath, bytes, JSON_TYPE)
  for (const object of media) stub.put(object.path, object.bytes, object.contentType)
  stub.put(sPath, snapshot.bytes, JSON_TYPE)
  stub.put(STAGING_POINTER_PATH, pointer.bytes, JSON_TYPE)
  return {
    pointerPath: STAGING_POINTER_PATH,
    snapshotPath: sPath,
    pointerBytes: pointer.bytes,
    snapshotBytes: snapshot.bytes,
    packages,
    media,
  }
}
