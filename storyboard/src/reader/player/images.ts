// Scene images (Step 10e; design p1-step10-design.md D11-P2 C14, P21, P22, §5; spec §6.5
// SPEC:486-489). Pure and framework-free. imageViewOf runs only on the server, inside playerDataOf,
// with the reader's checked media URL builder (mediaUrl from @/content, passed in by the page), so
// every ImageView carries finished URLs and the client never builds one. This module imports
// nothing from src/config or src/content.
// - srcSetOf: the asset's WebP variants only (a JPEG is never offered), each with its `w`
//   descriptor, in ascending width. No WebP variant, or a WebP variant without a positive width,
//   throws `player: <storyId> - <nodeId> image.webp|image.width missing` (ids only), which stops
//   the build: the second lock behind strict parse and the validator.
// - imageViewOf: the asset id (the <img> key), src (the smallest WebP), srcSet, sizes
//   (SCENE_IMAGE_SIZES) and the asset's own width and height, which size the aspect box before the
//   file arrives (the 1408×768 masters and the 33 square 1024×1024 ones alike, SPEC:486). A width or
//   height that is not positive throws `image.size missing`.
// - SCENE_IMAGE_SIZES: the one sizes value, shared by the <img> and its preload, so React keys the
//   preload by the same srcset plus sizes and the browser picks the same file for both (D11-P22).
//   60rem is --page-max (tokens.css).
// - nodeImageOf: a node's ImageView, or null (no picture: no box).
// - candidatesOf: the images the next step can show, for the prefetch: the distinct images of the
//   current node's choice targets that are not the current node's own image, in choice order (1,
//   or 2 at a fork, 0 at an ending).
// - preloadOf: the ReactDOM.preload arguments for one candidate: the same srcset and sizes as the
//   <img>, low priority, as an image; no href is needed by React for a srcset preload, and no
//   cross-origin mode is ever set (plain image loads, D11-P21).
// Imports are relative (C15): Vitest has no `@/` alias.
import { currentNodeId, type EngineState } from '../../core/engine'
import type { StoryAsset } from '../../core/package/v1'
import type { PlayerData } from './player-data'

/** The <img> sizes and its preload's imageSizes: the band is at most --page-max (60rem) wide. */
export const SCENE_IMAGE_SIZES = '(min-width: 60rem) 60rem, 100vw'

export type ImageAsset = Extract<StoryAsset, { kind: 'image' }>

/** The reader's media URL builder: CONTENT_PUBLIC_BASE + '/' + path (src/content mediaUrl). */
export type MediaUrlOf = (path: string) => string

/** Where an image is used, for the ids-only error messages. */
export interface ImageWhere {
  readonly storyId: string
  readonly nodeId: string
}

/** What the player needs to show one picture: finished URLs, no path, mime, bytes or provenance. */
export interface ImageView {
  /** The asset id: the <img> key and the failed-image id. */
  readonly id: string
  /** The smallest WebP variant's URL. */
  readonly src: string
  /** Every WebP variant as `<url> <width>w`, ascending. */
  readonly srcSet: string
  readonly sizes: string
  readonly width: number
  readonly height: number
}

/** The ReactDOM.preload arguments for one image (D11-P22). */
export interface ImagePreload {
  readonly href: string
  readonly options: {
    readonly as: 'image'
    readonly imageSrcSet: string
    readonly imageSizes: string
    readonly fetchPriority: 'low'
  }
}

const missing = (where: ImageWhere, field: string): Error =>
  new Error(`player: ${where.storyId} - ${where.nodeId} ${field} missing`)

/** The WebP variants as URL and width, ascending; throws when there is none or one has no width. */
function webpOf(
  asset: ImageAsset,
  mediaUrl: MediaUrlOf,
  where: ImageWhere,
): { readonly url: string; readonly width: number }[] {
  const webp = asset.variants.filter((variant) => variant.mime === 'image/webp')
  if (webp.length === 0) throw missing(where, 'image.webp')
  return webp
    .map((variant) => {
      const { width } = variant
      if (width === undefined || width <= 0) throw missing(where, 'image.width')
      return { url: mediaUrl(variant.path), width }
    })
    .sort((a, b) => a.width - b.width)
}

const srcSetText = (
  variants: readonly { readonly url: string; readonly width: number }[],
): string => variants.map(({ url, width }) => `${url} ${width}w`).join(', ')

/** `<url> <width>w` for every WebP variant, in ascending width. */
export function srcSetOf(asset: ImageAsset, mediaUrl: MediaUrlOf, where: ImageWhere): string {
  return srcSetText(webpOf(asset, mediaUrl, where))
}

export function imageViewOf(asset: ImageAsset, mediaUrl: MediaUrlOf, where: ImageWhere): ImageView {
  if (asset.width <= 0 || asset.height <= 0) throw missing(where, 'image.size')
  const variants = webpOf(asset, mediaUrl, where)
  const smallest = variants[0]
  if (smallest === undefined) throw missing(where, 'image.webp')
  return {
    id: asset.id,
    src: smallest.url,
    srcSet: srcSetText(variants),
    sizes: SCENE_IMAGE_SIZES,
    width: asset.width,
    height: asset.height,
  }
}

/** The node's picture, or null (no picture, or a node this data does not hold). */
export function nodeImageOf(data: PlayerData, nodeId: string): ImageView | null {
  return data.nodes.find((node) => node.id === nodeId)?.image ?? null
}

/** The distinct images of the current node's choice targets, never the current node's own. */
export function candidatesOf(data: PlayerData, state: EngineState): ImageView[] {
  const nodeId = currentNodeId(state)
  const node = data.nodes.find((n) => n.id === nodeId)
  if (node === undefined) return []
  const current = node.image?.id ?? null
  const seen = new Set<string>()
  const candidates: ImageView[] = []
  for (const choice of node.choices) {
    const image = nodeImageOf(data, choice.next)
    if (image === null || image.id === current || seen.has(image.id)) continue
    seen.add(image.id)
    candidates.push(image)
  }
  return candidates
}

/** The preload of one image: its own srcset and sizes, low priority (D11-P22). */
export function preloadOf(image: ImageView): ImagePreload {
  return {
    href: image.src,
    options: {
      as: 'image',
      imageSrcSet: image.srcSet,
      imageSizes: image.sizes,
      fetchPriority: 'low',
    },
  }
}
