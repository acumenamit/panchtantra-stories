import 'server-only'
// The content API pages use (design p1-step8-design.md §8; spec §3.2; P1-2b): one lazy reader per
// process over join(process.cwd(), '.content'), the folder scripts/load-content.ts writes before
// `next build`. The path is a string literal on purpose (P1-2c, design p1-step9-design.md R2):
// with the imported CONTENT_DIR, Turbopack cannot resolve it at build time, warns "Dynamic
// filesystem access causes tracing of the whole project" and traces every project file into each
// root page; with the literal it traces exactly the .content/ files. reader.test.ts pins the
// literal to CONTENT_DIR. The three root files read `contentMode()` for the staging banner (P1-2c); Step 10
// adds the player page, which reads listStoriesForLocale() and getStory(). Launch gating stays with
// the caller: the queries are content only, and the player's generateStaticParams combines
// listStoriesForLocale() with the launch state (P1-4b). Under `next dev` the folder may be stale
// or absent: run `pnpm content:load` first.
import { join } from 'node:path'
import type { BuildInfo } from '../core/content/build-info'
import type { GateMode } from '../core/content/gates'
import type { LocaleCode } from '../core/locales'
import {
  createContentReader,
  type BuiltStory,
  type ContentReader,
  type ReportContext,
  type StoryParam,
  type StorySummary,
} from './reader'

export type {
  BuiltStory,
  ContentReader,
  ReportContext,
  StoryParam,
  StorySummary,
  StorySummaryText,
} from './reader'

let reader: ContentReader | undefined

/** The process's reader, created on first use; it reads the folder on its first query. */
function current(): ContentReader {
  reader ??= createContentReader(join(process.cwd(), '.content'))
  return reader
}

/** False when .content/ is absent (CONTENT_SOURCE none or unset, or `next dev` without content:load). */
export function contentLoaded(): boolean {
  return current().contentLoaded()
}

export function contentMode(): GateMode | null {
  return current().contentMode()
}

export function getBuildInfo(): BuildInfo | null {
  return current().getBuildInfo()
}

/** Every built story, in build-info (snapshot) order. */
export function listStories(): readonly StorySummary[] {
  return current().listStories()
}

/** The stories whose package locales include `locale`, in build-info order; [] for a disabled locale. */
export function listStoriesForLocale(locale: LocaleCode): readonly StorySummary[] {
  return current().listStoriesForLocale(locale)
}

/** build-info's featuredStoryId only (the gated verdict), never the snapshot's. */
export function featuredStory(): StorySummary | null {
  return current().featuredStory()
}

/** null when the story was not built. */
export function getStory(storyId: string): BuiltStory | null {
  return current().getStory(storyId)
}

/** Enabled locales ∩ package locales; [] when nothing is loaded. */
export function storyParams(): readonly StoryParam[] {
  return current().storyParams()
}

/** The story, package hash and app version a problem report carries (spec §6.11), or null. */
export function reportContext(storyId: string): ReportContext | null {
  return current().reportContext(storyId)
}

/** CONTENT_PUBLIC_BASE + '/' + path; TypeError on an unsafe path. Reads no content. */
export function mediaUrl(path: string): string {
  return current().mediaUrl(path)
}
