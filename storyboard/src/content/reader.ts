import 'server-only'
// The server-only reader of the loaded content (spec §3.2 "Pages read only .content/"; design
// p1-step8-design.md §8, §3.4 rows 17-19, §9 item 36; P1-2b). Synchronous: it reads
// .content/build-info.json (strict BuildInfo) and, for each build-info row, the package file,
// re-hashed and strict-parsed. It never reads snapshot.json or pointer.json: the snapshot holds
// excluded entries and the ungated featuredStoryId. An absent folder is an empty catalogue; any
// other problem throws `content reader: …`, so `next build` stops. Inside the reader fence (no
// process.env, no scripts/ or tools/ imports); media URLs come from the committed public base.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONTENT_PUBLIC_BASE } from '../config/security-headers'
import { BuildInfo } from '../core/content/build-info'
import { isSafeStoragePath, parseStrictJson, type GateMode } from '../core/content/gates'
import { BUILD_INFO_FILE, PACKAGES_DIR, packageFileName } from '../core/content/output-layout'
import { ENABLED_LOCALE_CODES, isEnabledLocale, type LocaleCode } from '../core/locales'
import { StoryPackageV1 } from '../core/package/v1'

/** The locale strings a shelf or landing page shows for one story. */
export interface StorySummaryText {
  readonly title: string
  readonly description: string
  readonly theme: string
  readonly duration: string
  readonly book: string
}

/** What lists show for one built story, taken from its hash-checked package. */
export interface StorySummary {
  readonly storyId: string
  readonly version: number
  readonly packageSha256: string
  readonly addedOn: string
  readonly age: string
  readonly emoji: string
  readonly color: string
  readonly locales: readonly LocaleCode[]
  readonly defaultLocale: LocaleCode
  readonly source: StoryPackageV1['source']
  readonly aiUse: StoryPackageV1['aiUse']
  readonly text: Partial<Record<LocaleCode, StorySummaryText>>
}

/** One built story: its summary, the strict-parsed package and the sha256 build-info names. */
export interface BuiltStory {
  readonly summary: StorySummary
  readonly pkg: StoryPackageV1
  readonly packageSha256: string
}

/** The context a problem report carries (spec §6.11 payload). */
export interface ReportContext {
  readonly storyId: string
  readonly packageSha256: string
  readonly appVersion: string | null
}

export interface StoryParam {
  readonly locale: LocaleCode
  readonly storyId: string
}

/** The reader API (design §8), over one content folder. */
export interface ContentReader {
  /** False when the folder is absent (CONTENT_SOURCE none or unset, or `next dev` without content:load). */
  contentLoaded(): boolean
  contentMode(): GateMode | null
  getBuildInfo(): BuildInfo | null
  /** Every built story, in build-info (snapshot) order. */
  listStories(): readonly StorySummary[]
  /** The stories whose package locales include `locale`, in build-info order; [] for a disabled locale. */
  listStoriesForLocale(locale: LocaleCode): readonly StorySummary[]
  /** The story build-info names as featured (the gated verdict), or null. */
  featuredStory(): StorySummary | null
  /** null when the story was not built. */
  getStory(storyId: string): BuiltStory | null
  /** Enabled locales ∩ package locales, per story; [] when nothing is loaded. Content only: the caller applies the launch state. */
  storyParams(): readonly StoryParam[]
  reportContext(storyId: string): ReportContext | null
  /** CONTENT_PUBLIC_BASE + '/' + path; TypeError on an unsafe path. */
  mediaUrl(path: string): string
}

interface Loaded {
  readonly info: BuildInfo
  readonly stories: readonly BuiltStory[]
  readonly byId: ReadonlyMap<string, BuiltStory>
}

/** Absent folder: null, an empty catalogue. */
type State = Loaded | null

const PREFIX = 'content reader:'

function failClosed(message: string): never {
  throw new Error(`${PREFIX} ${message}`)
}

/** The bytes of a file that must exist, or a fail-closed error naming `what`. */
function readRequired(path: string, what: string): Uint8Array<ArrayBuffer> {
  let isFile = false
  try {
    isFile = statSync(path).isFile()
  } catch {
    // absent: reported below
  }
  if (!isFile) failClosed(`${what} is missing`)
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return failClosed(`${what} could not be read`)
  }
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function summaryOf(pkg: StoryPackageV1, packageSha256: string): StorySummary {
  const text: Partial<Record<LocaleCode, StorySummaryText>> = {}
  for (const locale of pkg.locales) {
    const t = pkg.text[locale]
    if (t === undefined) continue // the strict schema already requires one entry per locale
    text[locale] = Object.freeze({
      title: t.title,
      description: t.description,
      theme: t.theme,
      duration: t.duration,
      book: t.book,
    })
  }
  return Object.freeze({
    storyId: pkg.storyId,
    version: pkg.version,
    packageSha256,
    addedOn: pkg.addedOn,
    age: pkg.age,
    emoji: pkg.emoji,
    color: pkg.color,
    locales: Object.freeze([...pkg.locales]),
    defaultLocale: pkg.defaultLocale,
    source: Object.freeze({ ...pkg.source }),
    aiUse: Object.freeze({ ...pkg.aiUse }),
    text: Object.freeze(text),
  })
}

/** Reads and checks the folder once: build-info, then each row's package, in build-info order. */
function load(contentDir: string): State {
  if (!existsSync(contentDir)) return null
  if (!statSync(contentDir).isDirectory()) failClosed('the content folder is a file')

  const infoBytes = readRequired(join(contentDir, BUILD_INFO_FILE), BUILD_INFO_FILE)
  const info = parseStrictJson(infoBytes, BuildInfo, BUILD_INFO_FILE)
  if (!info.ok) failClosed(info.reason)
  const buildInfo = info.value.data

  const stories: BuiltStory[] = []
  const byId = new Map<string, BuiltStory>()
  for (const row of buildInfo.stories) {
    const label = `package ${row.storyId}`
    if (byId.has(row.storyId)) failClosed(`${BUILD_INFO_FILE} lists story ${row.storyId} twice`)
    const path = join(contentDir, PACKAGES_DIR, packageFileName(row.storyId))
    const bytes = readRequired(path, `${label} (${PACKAGES_DIR}/${packageFileName(row.storyId)})`)
    if (sha256Hex(bytes) !== row.packageSha256) {
      failClosed(`${label} sha256 does not match ${BUILD_INFO_FILE}`)
    }
    const parsed = parseStrictJson(bytes, StoryPackageV1, label)
    if (!parsed.ok) failClosed(parsed.reason)
    const pkg = parsed.value.data
    if (pkg.storyId !== row.storyId) {
      failClosed(`${label} has storyId ${pkg.storyId}, but ${BUILD_INFO_FILE} names ${row.storyId}`)
    }
    if (pkg.version !== row.version) {
      failClosed(`${label} has version ${pkg.version}, but ${BUILD_INFO_FILE} names ${row.version}`)
    }
    const built: BuiltStory = Object.freeze({
      summary: summaryOf(pkg, row.packageSha256),
      pkg,
      packageSha256: row.packageSha256,
    })
    stories.push(built)
    byId.set(row.storyId, built)
  }
  // The loader writes only a featured id it built (design §7); anything else is not its output.
  const featured = buildInfo.featuredStoryId
  if (featured !== null && !byId.has(featured)) {
    failClosed(`${BUILD_INFO_FILE} featuredStoryId ${featured} names no built story`)
  }
  return { info: buildInfo, stories: Object.freeze(stories), byId }
}

/** CONTENT_PUBLIC_BASE + '/' + path, for a safe Storage object path only. */
function mediaUrlOf(path: string): string {
  if (!isSafeStoragePath(path)) throw new TypeError('media path is unsafe')
  return `${CONTENT_PUBLIC_BASE}/${path}`
}

/**
 * A reader over `contentDir` (the app uses join(process.cwd(), CONTENT_DIR); tests pass a temp
 * folder). The folder is read on the first call that needs it and kept for the reader's life; a
 * failed read throws and is tried again on the next call.
 */
export function createContentReader(contentDir: string): ContentReader {
  let state: State | undefined
  const current = (): State => {
    if (state === undefined) state = load(contentDir)
    return state
  }
  const summaries = (): readonly StorySummary[] =>
    Object.freeze((current()?.stories ?? []).map((s) => s.summary))
  const forLocale = (locale: LocaleCode): readonly StorySummary[] =>
    isEnabledLocale(locale)
      ? Object.freeze(summaries().filter((s) => s.locales.includes(locale)))
      : Object.freeze([])

  return {
    contentLoaded: () => current() !== null,
    contentMode: () => current()?.info.mode ?? null,
    getBuildInfo: () => current()?.info ?? null,
    listStories: summaries,
    listStoriesForLocale: forLocale,
    featuredStory: () => {
      const loaded = current()
      const id = loaded?.info.featuredStoryId ?? null
      return id === null ? null : (loaded?.byId.get(id)?.summary ?? null)
    },
    getStory: (storyId) => current()?.byId.get(storyId) ?? null,
    storyParams: () =>
      Object.freeze(
        ENABLED_LOCALE_CODES.flatMap((locale) =>
          forLocale(locale).map((s) => Object.freeze({ locale, storyId: s.storyId })),
        ),
      ),
    reportContext: (storyId) => {
      const loaded = current()
      const story = loaded?.byId.get(storyId)
      if (!loaded || !story) return null
      return Object.freeze({
        storyId,
        packageSha256: story.packageSha256,
        appVersion: loaded.info.appVersion,
      })
    },
    mediaUrl: mediaUrlOf,
  }
}
