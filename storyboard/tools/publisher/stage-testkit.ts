// Test material for the publisher's stage tests (design migration-input/p1-step14-design.md §2.1,
// §8, §14.1 "Inputs", D14-22; P1-8c, Step 14). Not a test file, but used only by tests. Builds
// phase-2 versions of the committed fixture packages in memory: per story one image asset with two
// WebP widths of distinct bytes and one MP3 narration, each media path named by the sha256 of its
// own bytes (D14-22; never the asset id), provenance `unknown`; canonical JCS package bytes; and a
// zero-record waiver file. It reads fixtures/packages and never writes under fixtures/; it imports
// src/core and node: modules only, holds no key text and no route text, and never prints.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MediaMime } from '../../src/core/content/media'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import type { StoryAsset } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import type { WaiverFile } from '../../src/core/validator/waivers'

/** The committed fixture packages (read only). */
export const FIXTURE_PACKAGES_DIR = fileURLToPath(
  new URL('../../fixtures/packages/', import.meta.url),
)

export interface TestMedia {
  readonly path: string
  readonly mime: MediaMime
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly sha256: string
}

export interface TestStory {
  readonly storyId: string
  readonly pkg: StoryPackageV1
  /** Canonical JCS bytes of `pkg`. */
  readonly packageBytes: Uint8Array<ArrayBuffer>
  readonly packageSha256: string
  /** In declaration order: the two image widths, then the narration. */
  readonly media: readonly TestMedia[]
  /** A zero-record waiver file's raw bytes and their sha256 (its masters name). */
  readonly waiverBytes: Uint8Array<ArrayBuffer>
  readonly waiverSha256: string
}

export interface StageInputDirs {
  readonly packagesDir: string
  readonly mediaDir: string
  readonly waiversDir: string
}

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

/** A WebP whose RIFF size is its length minus 8, distinct per seed. */
export function webpBytes(seed: string): Uint8Array<ArrayBuffer> {
  const payload = encode(`VP8L${seed}`)
  const out = new Uint8Array(12 + payload.length)
  out.set([0x52, 0x49, 0x46, 0x46], 0)
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  out.set([0x57, 0x45, 0x42, 0x50], 8)
  out.set(payload, 12)
  return out
}

/** An MP3: an ID3v2.3 header with a 4-byte tag body, an MPEG frame sync, then the seed. */
export function mp3Bytes(seed: string): Uint8Array<ArrayBuffer> {
  const head = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]
  const payload = encode(seed)
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0)
  out.set(payload, head.length)
  return out
}

/** A zero-record waiver file (strict WaiverFile shape) for this rule set, or with given records. */
export function waiverFileOf(storyId: string, waivers: WaiverFile['waivers'] = []): WaiverFile {
  return {
    storyId,
    ruleSetRef: PANCHATANTRA_RULESET.ref,
    basis: 'synthetic test waiver file',
    waivers,
    notes: [],
    recordedOn: '2026-11-21',
    recordedBy: 'stage-testkit',
  }
}

/** A waiver file's raw bytes as the owner's editor would save them (two-space JSON, LF). */
export function waiverBytesOf(file: WaiverFile): Uint8Array<ArrayBuffer> {
  return encode(`${JSON.stringify(file, null, 2)}\n`)
}

/** The phase-2 package and its media for one phase-1 fixture package. */
async function phase2(p1: StoryPackageV1): Promise<{ pkg: StoryPackageV1; media: TestMedia[] }> {
  const id = p1.storyId
  const node = p1.nodes.find((n) => n.type !== 'ending')
  if (node === undefined) throw new TypeError('a fixture package has no non-ending node')
  const narrow = webpBytes(`${id}:w768`)
  const wide = webpBytes(`${id}:w1408`)
  const audio = mp3Bytes(`${id}:${node.id}:en`)
  const [narrowHex, wideHex, audioHex] = await Promise.all([
    sha256Hex(narrow),
    sha256Hex(wide),
    sha256Hex(audio),
  ])
  const media: TestMedia[] = [
    {
      path: `media/${id}/${narrowHex}-w768.webp`,
      mime: 'image/webp',
      bytes: narrow,
      sha256: narrowHex,
    },
    { path: `media/${id}/${wideHex}-w1408.webp`, mime: 'image/webp', bytes: wide, sha256: wideHex },
    { path: `media/${id}/${audioHex}-en.mp3`, mime: 'audio/mpeg', bytes: audio, sha256: audioHex },
  ]
  const imageId = await sha256Hex(encode(`${id}:image-master`))
  const narrated = await sha256Hex(encode(p1.text.en?.nodes[node.id]?.text ?? ''))
  const variantOf = (m: TestMedia) => ({ path: m.path, mime: m.mime, bytes: m.bytes.length })
  const image: StoryAsset = {
    kind: 'image',
    id: imageId,
    width: 1408,
    height: 768,
    variants: [
      { ...variantOf(media[0]!), width: 768 },
      { ...variantOf(media[1]!), width: 1408 },
    ],
    provenance: { origin: 'unknown' },
  }
  const narration: StoryAsset = {
    kind: 'audio',
    id: audioHex,
    nodeId: node.id,
    locale: 'en',
    durationMs: 1000,
    variants: [variantOf(media[2]!)],
    provenance: { origin: 'unknown' },
    narratedTextSha256: narrated,
  }
  const pkg = StoryPackageV1.parse({
    ...p1,
    nodes: p1.nodes.map((n) => (n.id === node.id ? { ...n, image: imageId } : n)),
    assets: [image, narration],
  })
  return { pkg, media }
}

/** A story with another package (bytes and sha256 recomputed); media and waiver file kept. */
export async function withPackage(story: TestStory, pkg: StoryPackageV1): Promise<TestStory> {
  const packageBytes = jcsBytes(pkg)
  return { ...story, pkg, packageBytes, packageSha256: await sha256Hex(packageBytes) }
}

/**
 * The phase-2 test stories, one per `<name>.json` in `fixturesDir` (default: the committed
 * fixtures), sorted by file name. Deterministic: two builds give equal bytes. Reads only.
 */
export async function buildTestStories(fixturesDir = FIXTURE_PACKAGES_DIR): Promise<TestStory[]> {
  const names = readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const stories: TestStory[] = []
  for (const name of names) {
    const p1 = StoryPackageV1.parse(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')))
    const { pkg, media } = await phase2(p1)
    const packageBytes = jcsBytes(pkg)
    const waiverBytes = waiverBytesOf(waiverFileOf(pkg.storyId))
    stories.push({
      storyId: pkg.storyId,
      pkg,
      packageBytes,
      packageSha256: await sha256Hex(packageBytes),
      media,
      waiverBytes,
      waiverSha256: await sha256Hex(waiverBytes),
    })
  }
  return stories
}

/**
 * Writes the stories as stage inputs under `root` (a temp folder the test owns): packages as
 * `<packages>/<id>.json`, media at their content paths under `<media>`, waiver files as
 * `<waivers>/<id>.json`. Existing files are overwritten; nothing is written outside `root`.
 */
export function writeStageInputs(root: string, stories: readonly TestStory[]): StageInputDirs {
  const dirs: StageInputDirs = {
    packagesDir: join(root, 'packages'),
    mediaDir: join(root, 'media-files'),
    waiversDir: join(root, 'waivers'),
  }
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
  for (const story of stories) {
    writeFileSync(join(dirs.packagesDir, `${story.storyId}.json`), story.packageBytes)
    writeFileSync(join(dirs.waiversDir, `${story.storyId}.json`), story.waiverBytes)
    for (const media of story.media) {
      const path = join(dirs.mediaDir, ...media.path.split('/'))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, media.bytes)
    }
  }
  return dirs
}
