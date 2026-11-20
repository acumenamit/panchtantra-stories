// Open Graph through Next 16.4.5's own resolver and renderer, for unit tests only (P1 Step 12, 12b;
// design p1-step12-design.md §3.21 N21, B4, B5, B8, R8; test plan T12-39, lead decision L9 and the
// §21 decisions). Node only, no server. T12-39 (next-social-head.test.ts, beside this file) pins
// what it renders, and check-build's [social] tests (scripts/check-build.test.ts, T12-26 g6, g4)
// build their pages from nextSocialHead, so the tag set they expect is the one Next emits. It sits
// in scripts/testing/, outside the app graph and outside the reader fence (eslint.config.mjs: src/ui
// may not import scripts/), so T12-39 runs once and no reader file imports it.
// homeOpenGraph and landingOpenGraph, with an origin and without, are passed as a page's
// { openGraph } through Next's resolveOpenGraph (resolvers/resolve-opengraph.js:134, a null
// metadataBase, as mergeMetadata calls it), Twitter's fill from openGraph, createMetadataElements
// (metadata-elements.js:94, OG :483-580, Twitter :1122-1203) and renderToStaticMarkup.
// Stop S11 (pre-approved, taken): Vitest cannot import metadata-resolution-primitives.js, the
// module of postProcessMetadata, because it requires 'server-only', which Next resolves only in its
// own bundler (the repo's Vitest alias reaches Vite-transformed modules, not Next's CommonJS
// require; probe in the 12b build run: "Cannot find module 'server-only'"). resolveOpenGraph,
// resolveTwitter, createDefaultMetadata and createMetadataElements do import, so this module runs
// them, and repeats by hand only postProcessMetadata's Twitter fill
// (metadata-resolution-primitives.js:393-428: a page with openGraph and no twitter gets twitter's
// title, description and images from openGraph through resolveTwitter) and createSelectedMetadata
// (:445-464, the absolute titles). The set branch's first real render stays H-25b (R8, R28).
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Metadata } from 'next'
import { createDefaultMetadata } from 'next/dist/lib/metadata/default-metadata.js'
import { createMetadataElements } from 'next/dist/lib/metadata/metadata-elements.js'
import {
  resolveOpenGraph,
  resolveTwitter,
} from 'next/dist/lib/metadata/resolvers/resolve-opengraph.js'
import type { LocaleCode } from '../../src/core/locales'
import { homeOpenGraph, landingOpenGraph } from '../../src/ui/root/social'

type OpenGraph = NonNullable<Metadata['openGraph']>
type Selected = Parameters<typeof createMetadataElements>[0]

/** Next's metadata context for this app: no trailingSlash, not a metadata image route. */
const CONTEXT = { trailingSlash: false, isStaticMetadataRouteFile: false }

/** A page whose head [social] reads: Home or a story landing. */
export type SocialPage =
  | { readonly kind: 'home'; readonly locale: LocaleCode; readonly description: string }
  | {
      readonly kind: 'landing'
      readonly locale: LocaleCode
      readonly storyId: string
      readonly title: string
      readonly description: string
    }

/** Next's convertUrlsToStrings (metadata-resolution-primitives.js:67-80): URL objects to strings. */
function urlsToStrings<T>(input: T): T {
  if (input instanceof URL) return input.toString() as T
  if (Array.isArray(input)) return input.map((item: unknown) => urlsToStrings(item)) as T
  if (input !== null && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, urlsToStrings(value)]),
    ) as T
  }
  return input
}

export interface Rendered {
  /** The resolved openGraph (as mergeMetadata stores it), as JSON. */
  readonly openGraph: unknown
  /** The resolved twitter (as postProcessMetadata stores it), as JSON; null when not filled. */
  readonly twitter: unknown
  /** The meta elements createMetadataElements returns, rendered to static markup. */
  readonly markup: string
}

/**
 * A page's `{ openGraph }` resolved and rendered as Next 16.4.5 does it (see the header for the two
 * steps repeated by hand). `twitterFill: false` skips postProcessMetadata's Twitter fill.
 */
export async function renderOpenGraph(
  input: OpenGraph,
  pathname: string,
  { twitterFill = true }: { readonly twitterFill?: boolean } = {},
): Promise<Rendered> {
  const og = urlsToStrings(
    await resolveOpenGraph(input, null, Promise.resolve(pathname), CONTEXT, null),
  )
  if (og === null) throw new Error('resolveOpenGraph returned null for an openGraph object')
  const twitter =
    twitterFill && og.title.absolute
      ? urlsToStrings(
          resolveTwitter(
            {
              title: og.title,
              description: og.description ?? undefined,
              images: og.images,
            } as Parameters<typeof resolveTwitter>[0],
            null,
            CONTEXT,
            null,
          ),
        )
      : null
  // createSelectedMetadata drops the fields used only while resolving or by the viewport pipeline.
  const fields: Record<string, unknown> = { ...createDefaultMetadata() }
  for (const key of ['metadataBase', 'themeColor', 'colorScheme', 'viewport']) delete fields[key]
  const selected = {
    ...fields,
    title: null,
    openGraph: { ...og, title: og.title.absolute },
    twitter: twitter === null ? null : { ...twitter, title: twitter.title.absolute },
  } as unknown as Selected
  const markup = renderToStaticMarkup(
    createElement(Fragment, null, ...createMetadataElements(selected)),
  )
  return {
    openGraph: JSON.parse(JSON.stringify(og)) as unknown,
    twitter: twitter === null ? null : (JSON.parse(JSON.stringify(twitter)) as unknown),
    markup,
  }
}

/** The page's path: /{locale} for Home, /{locale}/stories/{storyId} for a landing. */
export const pathOf = (page: SocialPage): string =>
  page.kind === 'home' ? `/${page.locale}` : `/${page.locale}/stories/${page.storyId}`

/** The page's `openGraph`, from homeOpenGraph or landingOpenGraph (src/ui/root/social.ts). */
export const openGraphOf = (origin: string | null, page: SocialPage): OpenGraph =>
  page.kind === 'home'
    ? homeOpenGraph({ origin, locale: page.locale, description: page.description })
    : landingOpenGraph({
        origin,
        locale: page.locale,
        storyId: page.storyId,
        title: page.title,
        description: page.description,
      })

/**
 * The Open Graph and Twitter meta elements Next 16.4.5 renders into the head of `page`, for a
 * build whose site origin is `origin` (null: no site URL in a Production build).
 */
export async function nextSocialHead({
  origin,
  page,
}: {
  readonly origin: string | null
  readonly page: SocialPage
}): Promise<string> {
  return (await renderOpenGraph(openGraphOf(origin, page), pathOf(page))).markup
}
