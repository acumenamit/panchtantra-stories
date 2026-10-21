// Loads the legacy CRA story modules (pt/src/stories/*.js) read-only, without executing the app.
// Each module is "const X = {...}; export default X;" with no imports; it is evaluated in an
// isolated vm context so that template-literal strings come out exactly as the app sees them.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'

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
  const sandbox: { __legacyStory?: unknown } = {}
  createContext(sandbox)
  runInContext(code, sandbox, { filename, timeout: 2000 })
  // Round-trip through JSON so the result holds only plain data from this realm.
  return JSON.parse(JSON.stringify(sandbox.__legacyStory)) as LegacyStory
}

/**
 * Reads every story module in the folder except index.js, sorted by file name.
 * CRLF is normalised to LF first: git stores these files with LF, but a Windows checkout may
 * hold CRLF. Hashing the LF form gives the same source hash on every machine and in CI.
 */
export function loadLegacyStories(storiesDir: string): LoadedLegacyStory[] {
  return readdirSync(storiesDir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort()
    .map((file) => {
      const text = readFileSync(join(storiesDir, file), 'utf8').replace(/\r\n/g, '\n')
      return {
        file,
        sourceSha256: sha256OfBytes(Buffer.from(text, 'utf8')),
        story: evaluateLegacyModule(text, file),
      }
    })
}
