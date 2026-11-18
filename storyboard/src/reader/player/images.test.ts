// Scene images (Step 10e; design p1-step10-design.md D11-P2 C14, P21, P22, §9.2 10e rows): the
// srcset of the WebP variants only, ascending, through the reader's media URL builder; a WebP
// variant without a width throws (ids only); the view of a 1408×768 and of a square 1024×1024
// picture carries its own width and height (C17); the prefetch candidates (2 at a fork, 1 at a
// single, 0 at an ending, never the current image, deduped); the preload arguments (the img's own
// srcset and sizes, low priority, no cross-origin mode); and SCENE_IMAGE_SIZES against --page-max.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import riverStones from '../../../fixtures/packages/river-stones.json'
import { start, step, type EngineState } from '../../core/engine'
import { ENABLED_LOCALE_CODES } from '../../core/locales'
import { StoryPackageV1 } from '../../core/package/v1'
import {
  SCENE_IMAGE_SIZES,
  candidatesOf,
  imageViewOf,
  nodeImageOf,
  preloadOf,
  srcSetOf,
  type ImageAsset,
  type ImageView,
} from './images'
import { graphOf, playerDataOf, type PlayerData } from './player-data'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = 'https://media.example/storage/v1/object/public/content'
const mediaUrl = (path: string): string => `${BASE}/${path}`
const STORY = 'picture-test'
const where = { storyId: STORY, nodeId: 'start' }

const hex = (c: string): string => c.repeat(64)

/** An image asset with WebP variants of the given widths (and any extra variants). */
function asset(
  id: string,
  width: number,
  height: number,
  widths: readonly number[],
  extra: ImageAsset['variants'] = [],
): ImageAsset {
  return {
    kind: 'image',
    id,
    width,
    height,
    variants: [
      ...widths.map((w) => ({
        path: `media/${STORY}/${id}-w${w}.webp`,
        mime: 'image/webp' as const,
        bytes: 34,
        width: w,
      })),
      ...extra,
    ],
    provenance: { origin: 'unknown' },
  }
}

const WIDE = asset(hex('a'), 1408, 768, [768, 1408])
const SQUARE = asset(hex('f'), 1024, 1024, [768, 1024])

/**
 * river-stones with pictures, as the staging picture story (§4.5): start, flat_stones,
 * round_stones, far_bank (square), ending_dry and ending_wet have one; big_rock and ending_back
 * have none. Strict-parsed, so the shape is a real package's.
 */
function picturePackage(images: Readonly<Record<string, string | null>>, assets: ImageAsset[]) {
  const pkg = structuredClone(riverStones)
  return StoryPackageV1.parse({
    ...pkg,
    storyId: STORY,
    nodes: pkg.nodes.map((node) => ({ ...node, image: images[node.id] ?? null })),
    assets,
  })
}

const IMAGES = {
  start: hex('a'),
  flat_stones: hex('b'),
  round_stones: hex('c'),
  far_bank: hex('f'),
  ending_dry: hex('d'),
  ending_wet: hex('e'),
}
const ASSETS = [
  WIDE,
  asset(hex('b'), 1408, 768, [1408, 768]), // declared descending: the srcset is still ascending
  asset(hex('c'), 1408, 768, [768, 1408]),
  SQUARE,
  asset(hex('d'), 1408, 768, [768, 1408]),
  asset(hex('e'), 1408, 768, [768, 1408]),
]
const pictures = playerDataOf(picturePackage(IMAGES, ASSETS), {
  locales: ENABLED_LOCALE_CODES,
  mediaUrl,
})

/** The engine state at the end of `path`. */
function at(data: PlayerData, path: readonly string[]): EngineState {
  const state = start(graphOf(data), { path: [...path], locale: 'en' })
  expect(state.path).toEqual(path)
  return state
}

const url = (id: string, w: number): string => `${BASE}/media/${STORY}/${id}-w${w}.webp`
const ids = (views: readonly ImageView[]): string[] => views.map((v) => v.id)

describe('srcSetOf (D11-P21): WebP only, ascending w descriptors, media URLs', () => {
  it('lists every WebP variant with its width, smallest first, through the media URL builder', () => {
    expect(srcSetOf(WIDE, mediaUrl, where)).toBe(
      `${url(hex('a'), 768)} 768w, ${url(hex('a'), 1408)} 1408w`,
    )
    expect(srcSetOf(asset(hex('b'), 1408, 768, [1408, 768]), mediaUrl, where)).toBe(
      `${url(hex('b'), 768)} 768w, ${url(hex('b'), 1408)} 1408w`,
    )
  })

  it('never offers a JPEG variant', () => {
    const jpeg = {
      path: `media/${STORY}/${hex('a')}-w1200.jpg`,
      mime: 'image/jpeg' as const,
      bytes: 34,
      width: 1200,
    }
    const mixed = asset(hex('a'), 1408, 768, [768, 1408], [jpeg])
    expect(srcSetOf(mixed, mediaUrl, where)).toBe(srcSetOf(WIDE, mediaUrl, where))
    expect(srcSetOf(mixed, mediaUrl, where)).not.toContain('.jpg')
    expect(imageViewOf(mixed, mediaUrl, where)).toEqual(imageViewOf(WIDE, mediaUrl, where))
  })

  it('throws, ids only, on a WebP variant without a positive width or with no WebP variant', () => {
    const noWidth = structuredClone(WIDE)
    delete noWidth.variants[1]!.width
    const zero = structuredClone(WIDE)
    zero.variants[0]!.width = 0
    for (const broken of [noWidth, zero]) {
      expect(() => srcSetOf(broken, mediaUrl, where)).toThrow(
        new Error('player: picture-test - start image.width missing'),
      )
      expect(() => imageViewOf(broken, mediaUrl, where)).toThrow(
        new Error('player: picture-test - start image.width missing'),
      )
    }
    const jpegOnly = asset(hex('a'), 1408, 768, [])
    jpegOnly.variants.push({
      path: `media/${STORY}/${hex('a')}-w768.jpg`,
      mime: 'image/jpeg',
      bytes: 34,
      width: 768,
    })
    expect(() => srcSetOf(jpegOnly, mediaUrl, where)).toThrow(
      new Error('player: picture-test - start image.webp missing'),
    )
    expect(() => imageViewOf(jpegOnly, mediaUrl, where)).toThrow(
      new Error('player: picture-test - start image.webp missing'),
    )
  })
})

describe('imageViewOf (D11-P21, C17): finished URLs and the picture own size', () => {
  it('a 1408×768 picture: variants 768 and 1408, its own width and height, src the smallest', () => {
    expect(imageViewOf(WIDE, mediaUrl, where)).toEqual({
      id: hex('a'),
      src: url(hex('a'), 768),
      srcSet: `${url(hex('a'), 768)} 768w, ${url(hex('a'), 1408)} 1408w`,
      sizes: SCENE_IMAGE_SIZES,
      width: 1408,
      height: 768,
    })
  })

  it('a square 1024×1024 picture (SPEC:486): variants 768 and 1024, width and height 1024', () => {
    expect(imageViewOf(SQUARE, mediaUrl, where)).toEqual({
      id: hex('f'),
      src: url(hex('f'), 768),
      srcSet: `${url(hex('f'), 768)} 768w, ${url(hex('f'), 1024)} 1024w`,
      sizes: SCENE_IMAGE_SIZES,
      width: 1024,
      height: 1024,
    })
  })

  it('throws, ids only, on a picture whose width or height is not positive', () => {
    for (const [width, height] of [
      [0, 768],
      [1408, 0],
      [-1, 768],
    ] as const) {
      expect(() => imageViewOf({ ...WIDE, width, height }, mediaUrl, where)).toThrow(
        new Error('player: picture-test - start image.size missing'),
      )
    }
  })

  it('SCENE_IMAGE_SIZES: the band is at most --page-max wide (tokens.css), else the viewport', () => {
    expect(SCENE_IMAGE_SIZES).toBe('(min-width: 60rem) 60rem, 100vw')
    const tokens = readFileSync(join(here, '../../ui/styles/tokens.css'), 'utf8')
    expect([...tokens.matchAll(/--page-max:\s*([^;]*);/g)].map((m) => m[1])).toEqual(['60rem'])
  })
})

describe('nodeImageOf and the picture data', () => {
  it('gives each node its view, or null for a node with no picture or one the data lacks', () => {
    for (const [nodeId, id] of Object.entries(IMAGES)) {
      const source = ASSETS.find((a) => a.id === id)!
      expect(nodeImageOf(pictures, nodeId)).toEqual(
        imageViewOf(source, mediaUrl, { storyId: STORY, nodeId }),
      )
    }
    expect(nodeImageOf(pictures, 'big_rock')).toBeNull()
    expect(nodeImageOf(pictures, 'ending_back')).toBeNull()
    expect(nodeImageOf(pictures, 'nope')).toBeNull()
  })
})

describe('candidatesOf (D11-P22): the next pictures, never the current one', () => {
  it('2 at a fork: both targets, in choice order', () => {
    expect(ids(candidatesOf(pictures, at(pictures, ['start'])))).toEqual([hex('b'), hex('c')])
  })

  it('1 at a single whose target has a picture; 0 when it has none', () => {
    expect(
      ids(candidatesOf(pictures, at(pictures, ['start', 'flat_stones', 'big_rock', 'far_bank']))),
    ).toEqual([hex('d')])
    // flat_stones → big_rock, which has no picture.
    expect(candidatesOf(pictures, at(pictures, ['start', 'flat_stones']))).toEqual([])
  })

  it('an alternate with two choices, one target without a picture: 1', () => {
    expect(ids(candidatesOf(pictures, at(pictures, ['start', 'round_stones'])))).toEqual([hex('e')])
  })

  it('0 at an ending', () => {
    for (const end of [
      ['start', 'round_stones', 'ending_wet'],
      ['start', 'round_stones', 'ending_back'],
      ['start', 'flat_stones', 'big_rock', 'far_bank', 'ending_dry'],
    ]) {
      expect(candidatesOf(pictures, at(pictures, end))).toEqual([])
    }
  })

  it('never the current image: a target that shows the same picture is left out', () => {
    const same = playerDataOf(picturePackage({ ...IMAGES, flat_stones: hex('a') }, ASSETS), {
      locales: ENABLED_LOCALE_CODES,
      mediaUrl,
    })
    expect(ids(candidatesOf(same, at(same, ['start'])))).toEqual([hex('c')])
  })

  it('deduped: two targets with one picture give it once', () => {
    const shared = playerDataOf(picturePackage({ ...IMAGES, round_stones: hex('b') }, ASSETS), {
      locales: ENABLED_LOCALE_CODES,
      mediaUrl,
    })
    expect(ids(candidatesOf(shared, at(shared, ['start'])))).toEqual([hex('b')])
  })

  it('follows the run: after a step the candidates are the new node targets', () => {
    const first = at(pictures, ['start'])
    const r = step(graphOf(pictures), first, { type: 'CHOOSE', seq: first.seq, choiceId: 'c2' })
    expect(r.accepted).toBe(true)
    expect(ids(candidatesOf(pictures, r.state))).toEqual([hex('e')])
  })
})

describe('preloadOf (D11-P22): the img own srcset and sizes, low priority, an image', () => {
  it('for every candidate of every node', () => {
    let checked = 0
    for (const node of pictures.nodes) {
      for (const image of node.choices.map((c) => nodeImageOf(pictures, c.next))) {
        if (image === null) continue
        expect(preloadOf(image)).toEqual({
          href: image.src,
          options: {
            as: 'image',
            imageSrcSet: image.srcSet,
            imageSizes: SCENE_IMAGE_SIZES,
            fetchPriority: 'low',
          },
        })
        // No cross-origin mode: React would then key and fetch a different request than the img.
        expect(Object.keys(preloadOf(image).options).sort()).toEqual([
          'as',
          'fetchPriority',
          'imageSizes',
          'imageSrcSet',
        ])
        checked++
      }
    }
    expect(checked).toBe(5)
  })
})
