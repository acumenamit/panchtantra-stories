// Media HEAD gate, pure parts (spec §3.2 "Media HEAD"; design p1-step8-design.md §6.1-§6.3, §3.4
// rows 24, 25 and 38, §9 items 23 and 25; P1-2b). planMediaHeads checks every declared variant of
// every included package before any request; judgeHead decides one HEAD answer. The requests, the
// pool and the log lines are in scripts/content/media-gate.ts.
import type { StoryPackageV1 } from '../package/v1'
import { isSafeStoragePath, safeLogText, type GateResult } from './gates'

/** The `content` bucket's file size limit (supabase/config.toml), the most a variant may declare. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024

/** The file extension each declared mime must have (spec:271 `<sha256>-<variant>.<ext>`). */
export const MEDIA_EXTENSIONS = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'audio/mpeg': 'mp3',
} as const satisfies Record<StoryPackageV1['assets'][number]['variants'][number]['mime'], string>

export type MediaMime = keyof typeof MEDIA_EXTENSIONS

/** The name after `<root>media/<storyId>/`: 64 hex, a variant name of 1-16 [a-z0-9], an extension. */
const MEDIA_NAME = /^[0-9a-f]{64}-[a-z0-9]{1,16}\.([a-z0-9]+)$/

/** What planMediaHeads reads from a package: its id and its assets (a CheckedPackage fits). */
export interface MediaPackage {
  readonly pkg: Pick<StoryPackageV1, 'storyId' | 'assets'>
}

/** One HEAD to make: one declared variant. */
export interface MediaHead {
  readonly storyId: string
  readonly path: string
  readonly mime: MediaMime
  readonly bytes: number
  /** Declaration order across the build (package, asset, variant), from 0; failures sort by it. */
  readonly order: number
}

/** Per included package, for `content: media story=<id> variants=<n> bytes=<sum> ok`. */
export interface MediaStory {
  readonly storyId: string
  readonly variants: number
  readonly bytes: number
}

export interface MediaPlan {
  /** Every declared variant, in declaration order; no path appears twice. */
  readonly heads: readonly MediaHead[]
  /** Every package passed in, in order, including those that declare no media. */
  readonly stories: readonly MediaStory[]
}

/**
 * The media pre-checks (design §6.2), with no network: for every variant of every asset of every
 * package, in declaration order, 1. the path is a safe Storage path; 2. it is
 * `<root>media/<storyId>/<64 hex>-<[a-z0-9]{1,16}>.<ext>`; 3. `<ext>` is the mime's (webp, jpg,
 * mp3); 4. no path is declared twice in the build (never de-duplicated); 5. at most 10 MiB is
 * declared. The first violation fails as `package <id> media <path>: <rule>`.
 */
export function planMediaHeads(
  packages: readonly MediaPackage[],
  root: string,
): GateResult<MediaPlan> {
  const heads: MediaHead[] = []
  const stories: MediaStory[] = []
  const seen = new Set<string>()
  for (const { pkg } of packages) {
    const { storyId } = pkg
    const prefix = `${root}media/${storyId}/`
    let variants = 0
    let bytes = 0
    for (const asset of pkg.assets) {
      for (const variant of asset.variants) {
        const { path, mime } = variant
        const failWith = (rule: string, shown = path): GateResult<MediaPlan> => ({
          ok: false,
          reason: `package ${storyId} media ${shown}: ${rule}`,
        })
        if (!isSafeStoragePath(path)) return failWith('path is unsafe', safeLogText(path))
        const name = path.startsWith(prefix) ? MEDIA_NAME.exec(path.slice(prefix.length)) : null
        if (!name) return failWith(`path must be ${prefix}<64 hex>-<variant>.<ext>`)
        const want = MEDIA_EXTENSIONS[mime]
        if (name[1] !== want) return failWith(`extension must be ${want} for ${mime}`)
        if (seen.has(path)) return failWith('path is declared more than once')
        if (variant.bytes > MEDIA_MAX_BYTES) {
          return failWith(`declares ${variant.bytes} bytes; at most ${MEDIA_MAX_BYTES}`)
        }
        seen.add(path)
        heads.push({ storyId, path, mime, bytes: variant.bytes, order: heads.length })
        variants++
        bytes += variant.bytes
      }
    }
    stories.push({ storyId, variants, bytes })
  }
  return { ok: true, value: { heads, stories } }
}

export type HeadVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** The headers judgeHead reads (a fetch Headers object fits). */
export type HeadHeaders = Pick<Headers, 'get'>

// The Fetch standard's redirect statuses; a 304 is not one and reads as `status 304`.
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/**
 * The HEAD pass rule (design §6.3), checked in this order: (a) status exactly 200; (b)
 * content-length present, `^\d{1,12}$` and equal to the declared bytes; (c) the media type
 * (parameters ignored, lowercased) equal to the declared mime; (d) content-encoding absent or
 * `identity` (case-insensitive). The first failure gives the reason for the `media failed` line;
 * header values in it pass through safeLogText.
 */
export function judgeHead(
  variant: { readonly mime: string; readonly bytes: number },
  status: number,
  headers: HeadHeaders,
): HeadVerdict {
  const bad = (reason: string): HeadVerdict => ({ ok: false, reason })
  if (status !== 200) {
    return bad(
      REDIRECT_STATUSES.has(status) ? `redirect ${status} (not followed)` : `status ${status}`,
    )
  }
  const length = headers.get('content-length')
  if (length === null) return bad('content-length missing')
  if (!/^\d{1,12}$/.test(length) || Number(length) !== variant.bytes) {
    return bad(`content-length ${safeLogText(length)} does not match declared ${variant.bytes}`)
  }
  const type = mediaTypeOf(headers.get('content-type'))
  if (type !== variant.mime) {
    return bad(
      `content-type ${type === '' ? 'none' : safeLogText(type)} does not match declared ${variant.mime}`,
    )
  }
  const encoding = headers.get('content-encoding')
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') {
    return bad(`content-encoding ${safeLogText(encoding)} is not identity`)
  }
  return { ok: true }
}

/**
 * True when the answer offers byte ranges (`Accept-Ranges: bytes`, case-insensitive). Recorded in
 * a note line only; never a gate (design §3.4 row 11).
 */
export function acceptsByteRanges(headers: HeadHeaders): boolean {
  const value = headers.get('accept-ranges') ?? ''
  return value.split(',').some((unit) => unit.trim().toLowerCase() === 'bytes')
}

/**
 * The media type without parameters, lowercased: the rule of tools/publisher/http.ts mediaType
 * (no src/ module imports tools/, and src/content may not), so `audio/mpeg; charset=x` compares
 * as `audio/mpeg`. media.test.ts checks the two agree.
 */
export function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase()
}
