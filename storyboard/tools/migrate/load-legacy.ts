// Loads the legacy CRA story modules (pt/src/stories/*.js) read-only, without executing the app.
// Each module is "const X = {...}; export default X;" with no imports; it is evaluated in a vm
// context so that template-literal strings come out exactly as the app sees them.
// SEC3-1 (design migration-input/p1-step16-design.md §3.21, D16-21; P1 Step 16): nothing is
// evaluated until the folder holds exactly the frozen file set of legacy-manifest.json and every
// file's LF sha256 equals its frozen value. Each file is read once, decoded as strict UTF-8, and the
// text that was hashed is the text evaluated. The vm context's sandbox has a null prototype, so the
// constructor chain does not reach the host's Function. node:vm is no security boundary: the hash
// check is the guard; the null prototype only closes that one escape.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import manifest from './legacy-manifest.json'

export interface LegacyText {
  readonly en: string
  readonly hi: string
}

export interface LegacyChoice {
  readonly text: LegacyText
  readonly next: string
}

export interface LegacyNode {
  readonly scene: string
  readonly image?: string
  readonly text: LegacyText
  readonly question?: LegacyText
  readonly choices?: readonly LegacyChoice[]
  readonly isAlternate?: boolean
  readonly isEnding?: boolean
  readonly lesson?: LegacyText
  readonly lessonIcon?: string
}

export interface LegacyStory {
  readonly id: string
  readonly title: LegacyText
  readonly description: LegacyText
  readonly theme: LegacyText
  readonly age: string
  readonly duration: LegacyText
  readonly addedOn: string
  readonly featured: boolean
  readonly emoji: string
  readonly color: string
  readonly book: LegacyText
  readonly progressSteps: readonly string[]
  readonly nodes: Readonly<Record<string, LegacyNode>>
}

export interface LoadedLegacyStory {
  readonly file: string
  readonly sourceSha256: string
  readonly story: LegacyStory
}

const EXPORT_DEFAULT = /export\s+default\s+(\w+)\s*;?\s*$/

export function sha256OfBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function evaluateLegacyModule(source: string, filename: string): LegacyStory {
  if (!EXPORT_DEFAULT.test(source))
    throw new Error(`${filename}: no trailing "export default <name>"`)
  if (/^\s*import\s/m.test(source)) throw new Error(`${filename}: imports are not supported`)
  const code = source.replace(EXPORT_DEFAULT, 'globalThis.__legacyStory = $1;')
  // A null prototype: `this.constructor` inside the context never names the host's Object.
  const sandbox = Object.create(null) as { __legacyStory?: unknown }
  createContext(sandbox)
  runInContext(code, sandbox, { filename, timeout: 2000 })
  // Round-trip through JSON so the result holds only plain data from this realm.
  return JSON.parse(JSON.stringify(sandbox.__legacyStory)) as LegacyStory
}

/** How the loader reads the folder: every entry name (files and folders) and one file's bytes. */
export interface LegacyIo {
  readonly list: (dir: string) => readonly string[]
  readonly read: (path: string) => Uint8Array
}

const DEFAULT_IO: LegacyIo = {
  list: (dir) => readdirSync(dir),
  read: (path) => readFileSync(path),
}

/** The manifest keys of the story modules: `pt/src/stories/<file>`. */
const FROZEN_PREFIX = 'pt/src/stories/'
const SET_DIFFERS = 'legacy stories: the file set differs from the frozen manifest'

/**
 * Reads every story module of the frozen manifest, through `loadFrozenLegacyStories`.
 * CRLF is normalised to LF first: git stores these files with LF, but a Windows checkout may
 * hold CRLF. Hashing the LF form gives the same source hash on every machine and in CI.
 */
export function loadLegacyStories(storiesDir: string): LoadedLegacyStory[] {
  return loadFrozenLegacyStories(storiesDir, manifest.sourceFiles)
}

/**
 * The frozen load (SEC3-1), in this order, so a refusal evaluates nothing:
 * 1. the listed names ending `.js`, except exactly `index.js`, must equal the `frozen` keys under
 *    pt/src/stories/ (names compared exactly, case included), and not be empty;
 * 2. each file is read once and decoded as strict UTF-8 (a BOM is kept), CRLF to LF, then hashed;
 * 3. every hash must equal its frozen value;
 * 4. only then each in-memory LF text is evaluated, sorted by UTF-16 code units.
 */
export function loadFrozenLegacyStories(
  storiesDir: string,
  frozen: Readonly<Record<string, string>>,
  io: LegacyIo = DEFAULT_IO,
): LoadedLegacyStory[] {
  const names = io
    .list(storiesDir)
    .filter((name) => name.endsWith('.js') && name !== 'index.js')
    .sort()
  const expected = new Set(
    Object.keys(frozen)
      .filter((key) => key.startsWith(FROZEN_PREFIX))
      .map((key) => key.slice(FROZEN_PREFIX.length)),
  )
  if (
    names.length === 0 ||
    names.length !== expected.size ||
    new Set(names).size !== names.length ||
    !names.every((name) => expected.has(name))
  ) {
    throw new Error(SET_DIFFERS)
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const sources = names.map((file) => {
    const bytes = io.read(join(storiesDir, file))
    let text: string
    try {
      text = decoder.decode(bytes)
    } catch {
      throw new Error(`${file}: source is not valid UTF-8`)
    }
    text = text.replace(/\r\n/g, '\n')
    return { file, text, sourceSha256: sha256OfBytes(Buffer.from(text, 'utf8')) }
  })
  for (const { file, sourceSha256 } of sources) {
    if (frozen[`${FROZEN_PREFIX}${file}`] !== sourceSha256) {
      throw new Error(`${file}: source hash differs from the frozen manifest`)
    }
  }
  return sources.map(({ file, text, sourceSha256 }) => ({
    file,
    sourceSha256,
    story: evaluateLegacyModule(text, file),
  }))
}
