// The Storage client's fence proof (design p1-step13-design.md §3.13 and §13.7; rows A16-A18 and
// A32-A34; guards G3 and G4). The client is fenced only if no other code can send Storage requests or
// reach the key, so this file checks, over the whole repository:
// - export lists (FX): a new export of a fenced module fails until it is reviewed;
// - the reach walk (FW): fences F1-F6 over the import graph from every non-test script, with every
//   import form of catalogue class 12, failing closed on what it cannot follow; a fenced module named
//   by its repository path in a script literal or runnable text is a finding too (FW7); F4 has its
//   reviewed row since Step 15b (the content deleter and its first caller, cli.ts);
// - one file walker (FS0) with one exclusion list, the same on this PC and CI. It never reads a
//   `.env*` name, classifies every extension and fails closed on unreadable files, syntax errors,
//   `.env`-named entries .gitignore does not keep out and an empty walk; it skips only the test files
//   a runner runs;
// - three scans: S1, the Storage request surface (FS1), S2, the key's reach (FS2), and S3,
//   Secret.reveal and writes to the global fetch on the AST (FS3), each with the per-form allow-list
//   of §3.13.4; runnable text is also read with its quotes and escapes removed;
// - literal and import pins of storage.ts, storage-layout.ts, the stub and the deleter (FS4).
// Findings print only `path:line form-id` (or a walker finding), never the matched text (FS5).
// The in-memory samples and the real tree run through the same walker and scans.
import { builtinModules } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/** storyboard/ */
const ROOT = join(HERE, '..', '..')
/** The repository root, storyboard's parent (D:/Panchtrantra-Kahaniyan here, the checkout root on CI). */
const REPO = join(ROOT, '..')
/** The repository's .github, walked under the name `.github`. */
const GITHUB = join(REPO, '.github')
/** The repository root as the walk names it: a root file is `../<name>` (review fix SEC2-6). */
const REPO_DIR = '..'
const WALK_TIMEOUT = 60_000

// ---- the tree reader (injectable: the real tree and the in-memory samples share the walker) ----

interface DirEntry {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'other'
}

interface TreeReader {
  /** The entries of a folder ('' is the root); throws when it cannot be read. */
  list(dir: string): readonly DirEntry[]
  /** A file's text; throws when it cannot be read. */
  read(path: string): string
}

/**
 * The repository root's top-level names (listed as `..`; review fix SEC2-6), the storyboard tree ('')
 * and the repository's .github, with '/' paths built from readdir names.
 */
function realReader(root = ROOT, github = GITHUB, repo = REPO): TreeReader {
  const abs = (path: string) =>
    path === REPO_DIR || path.startsWith(`${REPO_DIR}/`)
      ? join(repo, path.slice(REPO_DIR.length))
      : path === '.github' || path.startsWith('.github/')
        ? join(github, path.slice('.github'.length))
        : join(root, path)
  return {
    list: (dir) => {
      const entries: DirEntry[] = readdirSync(abs(dir), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'other',
      }))
      if (dir !== '') return entries
      // A .github inside storyboard is not the one GitHub reads: it becomes an unknown folder.
      return entries.map((entry) =>
        entry.name === '.github' ? { ...entry, name: '.github-inside-storyboard' } : entry,
      )
    },
    read: (path) => readFileSync(abs(path), 'utf8'),
  }
}

/**
 * A file's text, the error code its read throws (EACCES; ENOENT for one that vanished), or a link
 * (a symbolic link or a Windows junction), which the real reader lists as kind 'other' (review fix
 * SEC3-3).
 */
type MemoryFile = string | { readonly error: string } | { readonly link: true }

/**
 * Files by '/' path; folders come from the paths. Every read is logged in `reads`. A `../<name>` key
 * is a repository-root entry (SEC2-6). The root always holds storyboard (the '' tree) and, when a
 * `.github/` key exists, the repository's .github, so a `.github/` key is never storyboard's; a
 * `../storyboard` key of its own (a link) takes the place of the storyboard folder.
 */
function memoryReader(files: Readonly<Record<string, MemoryFile>>, reads: string[]): TreeReader {
  const paths = Object.keys(files)
  const atRoot = (path: string) => path.startsWith(`${REPO_DIR}/`)
  const isLink = (file: MemoryFile | undefined) => typeof file === 'object' && 'link' in file
  return {
    list: (dir) => {
      const prefix = dir === '' ? '' : `${dir}/`
      const entries = new Map<string, DirEntry>()
      for (const path of paths) {
        if (!path.startsWith(prefix) || (dir === '' && atRoot(path))) continue
        const rest = path.slice(prefix.length)
        const slash = rest.indexOf('/')
        const name = slash < 0 ? rest : rest.slice(0, slash)
        const kind = slash >= 0 ? 'dir' : isLink(files[path]) ? 'other' : 'file'
        entries.set(name, { name, kind })
      }
      if (dir === REPO_DIR) {
        if (!entries.has('storyboard')) {
          entries.set('storyboard', { name: 'storyboard', kind: 'dir' })
        }
        if (paths.some((path) => path.startsWith('.github/'))) {
          entries.set('.github', { name: '.github', kind: 'dir' })
        }
      }
      if (dir === '') entries.delete('.github')
      if (dir !== '' && entries.size === 0) throw new Error('ENOENT')
      return [...entries.values()]
    },
    read: (path) => {
      reads.push(path)
      const file = files[path]
      if (typeof file === 'string') return file
      const code = file === undefined ? 'EISDIR' : 'error' in file ? file.error : 'ELOOP'
      throw Object.assign(new Error(`${code}: cannot read Q7MARK`), { code })
    },
  }
}

function recording(reader: TreeReader, reads: string[]): TreeReader {
  return {
    list: (dir) => reader.list(dir),
    read: (path) => {
      reads.push(path)
      return reader.read(path)
    },
  }
}

/**
 * A folder's names as a test prints or compares them (folders end in `/`): a `.env*` name, in any
 * case, is counted and never named, as the walker's own prints do (review fix R3T-2).
 */
function shownNames(entries: readonly DirEntry[]): { names: string[]; envHidden: number } {
  const shown = entries.filter((entry) => !entry.name.toLowerCase().startsWith('.env'))
  return {
    names: shown.map((entry) => (entry.kind === 'dir' ? `${entry.name}/` : entry.name)).sort(),
    envHidden: entries.length - shown.length,
  }
}

// ---- the file walker (§3.13.2; FS0) ----

/** storyboard's top-level folders the walk reads. Any other top-level folder is a finding. */
const TOP_WALKED: ReadonlySet<string> = new Set([
  'app',
  'e2e',
  'fixtures',
  'messages',
  'public',
  'scripts',
  'src',
  'supabase',
  'tools',
])

/** One exclusion list, the same on this PC and CI (lead decision 14), each with its reason. */
const TOP_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['node_modules', 'dependencies'],
  ['.next', 'build output'],
  ['.content', 'loader output'],
  ['test-results', 'run output'],
  ['playwright-report', 'run output'],
  ['coverage', 'run output'],
  ['.vitest', 'reporter output'],
  ['migration-input', 'gitignored; exists on this PC only; holds private waivers'],
  ['.rules-private', 'private rule data (NI-4); never read'],
  ['.impeccable', 'editor cache'],
  ['.vercel', 'local link'],
])
const NESTED_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['supabase/.temp', 'Supabase CLI cache (supabase/.gitignore)'],
  ['supabase/.branches', 'Supabase CLI cache (supabase/.gitignore)'],
])
const ROOT_FILES_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['tsconfig.tsbuildinfo', 'generated; untracked'],
  ['next-env.d.ts', 'generated; untracked'],
])

/**
 * The repository root's top-level names (review fix SEC2-6; design §17): three folders walked
 * (storyboard is the '' tree; docs/ like any root folder, without docs/design, lead decision §20),
 * the three files read as text through the scans, and the names excluded by name, whatever their
 * kind, each with its reason (an extension of lead decision 14). Any other root entry is a finding
 * `unknown-folder <name>` or `unknown-extension <ext>` and is never read. What an excluded name hides
 * is the §6 T13 residual (review fix SEC3-1): every pt/src/stories/*.js but index.js is evaluated in
 * the unit run through node:vm (tools/migrate/load-legacy.ts, called by migrate.test.ts), and it is
 * not scanned. A reason that says gitignored must be true of the root .gitignore (FS0e g11).
 */
const ROOT_WALKED: ReadonlyMap<string, string> = new Map([
  ['.github', '.github'],
  ['storyboard', ''],
  ['docs', `${REPO_DIR}/docs`],
])
const ROOT_TEXT: ReadonlySet<string> = new Set(['README.md', '.gitignore', '.gitattributes'])
const ROOT_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['pt', 'the legacy app; no publisher code'],
  ['.git', "git's own database; no working file (this PC and CI's checkout)"],
  ['.claude', 'local AI tooling config; gitignored; this PC only'],
  ['.code-review-graph', 'local code graph cache; gitignored; this PC only'],
  ['.mcp.json', 'local AI tooling config; gitignored; this PC only'],
  ['CLAUDE.md', 'local AI tooling notes; gitignored; this PC only'],
  ['.impeccable', 'editor cache; gitignored by /.impeccable/ in the root .gitignore; this PC only'],
])
/**
 * Inside a walked root folder, by path from the repository root and only as a folder (lead decision
 * §20, SEC3-2 option b): the root .gitignore's `/docs/design/` ignores a folder, so a file or a link
 * of that name is walked like any other entry (a finding, never read).
 */
const ROOT_NESTED_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ['docs/design', 'gitignored /docs/design/; internal documents'],
])

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
])
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'json',
  'yml',
  'yaml',
  'ipynb',
  'md',
  'txt',
  'sql',
  'toml',
  'sh',
  'bash',
  'ps1',
  'psm1',
  'py',
  'cmd',
  'bat',
  'html',
  'xml',
  'svg',
])
const TEXT_NAMES: ReadonlySet<string> = new Set(['.gitignore', '.prettierignore', '.nvmrc'])
const INERT_EXTENSIONS: ReadonlySet<string> = new Set([
  'css',
  'woff',
  'woff2',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'ico',
  'mp3',
])
/** A lockfile runs nothing; any change to it is forbidden and reviewed. */
const INERT_NAMES: ReadonlySet<string> = new Set(['pnpm-lock.yaml'])
/** Text files that can run: the S2 env-file text rule reads these. */
const RUNNABLE_TEXT: ReadonlySet<string> = new Set([
  'json',
  'yml',
  'yaml',
  'ipynb',
  'sh',
  'bash',
  'ps1',
  'psm1',
  'py',
  'cmd',
  'bat',
])

type FileClass = 'script' | 'text' | 'inert'

interface WalkedFile {
  readonly path: string
  readonly cls: FileClass
  /** Lower-case extension, '' for a dot-name such as .gitignore. */
  readonly ext: string
  /** null for an inert file (never read). */
  readonly text: string | null
}

interface Walk {
  readonly files: readonly WalkedFile[]
  readonly findings: readonly string[]
  readonly trees: ReadonlyMap<string, ts.SourceFile>
  /** How many `.env*` names were skipped unread (printed, never named). */
  readonly envSkipped: number
}

/** The extension after the last dot (lower case), or null for none or a dot-name. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase()
}

type Classified = { readonly cls: FileClass; readonly ext: string } | { readonly unknown: string }

function classify(name: string): Classified {
  if (INERT_NAMES.has(name)) return { cls: 'inert', ext: extensionOf(name) ?? '' }
  if (TEXT_NAMES.has(name)) return { cls: 'text', ext: '' }
  const ext = extensionOf(name)
  if (ext === null) return { unknown: '(none)' }
  if (SCRIPT_EXTENSIONS.has(ext)) return { cls: 'script', ext }
  if (TEXT_EXTENSIONS.has(ext)) return { cls: 'text', ext }
  if (INERT_EXTENSIONS.has(ext)) return { cls: 'inert', ext }
  return { unknown: ext }
}

/** TSX for .tsx, JSX for .jsx, JS for .js .mjs .cjs, TS otherwise (§3.13.2). */
function scriptKindOf(path: string): ts.ScriptKind {
  const ext = extensionOf(path.slice(path.lastIndexOf('/') + 1))
  if (ext === 'tsx') return ts.ScriptKind.TSX
  if (ext === 'jsx') return ts.ScriptKind.JSX
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** The syntax diagnostics count, or null when TypeScript does not expose the array (fail closed). */
function syntaxErrorsOf(tree: ts.SourceFile): number | null {
  const diagnostics: unknown = Reflect.get(tree, 'parseDiagnostics')
  return Array.isArray(diagnostics) ? diagnostics.length : null
}

/**
 * The test files a runner runs, and only those, are skipped (B9; review fix SEC2-1): Vitest's include
 * (vitest.config.mts: `*.test.ts` under src, tools and scripts) and Playwright's default testMatch under
 * its testDir e2e (`*.@(spec|test).?(c|m)[jt]s?(x)`). A path with a segment that starts with `.` is
 * never skipped. Any other test-like name (a workflow `x.test.yml`, a `scripts/x.test.mjs`) runs as
 * something else, so it is walked and scanned like any other file.
 */
const RUN_BY_VITEST = /^(?:src|tools|scripts)(?:\/[^/.][^/]*)*\/[^/.][^/]*\.test\.ts$/
const RUN_BY_PLAYWRIGHT = /^e2e(?:\/[^/.][^/]*)*\/[^/.][^/]*\.(?:spec|test)\.[cm]?[jt]sx?$/
const isRunnerTest = (path: string) => RUN_BY_VITEST.test(path) || RUN_BY_PLAYWRIGHT.test(path)

/**
 * The names .gitignore keeps out of the repository (`.env` and `.env.*`, case-sensitive as CI's Linux
 * git reads them): refused before any read and only counted. Any other entry whose name starts `.env`
 * in any case, a folder included, is never read either, but is a finding that names only its parent
 * folder (review fix SEC2-3): `scripts/.envx/` or `tools/.environment.ts` could be committed and would
 * otherwise hide code from every scan. `.env.example` is not kept out: the root .gitignore negates it
 * (`!.env.example`, line 11), and git on Windows (core.ignorecase) reads that negation in any case, so
 * `.env.example` in any letter case is such a finding too (review fix SEC3-4).
 */
const GITIGNORED_ENV = /^\.env(?:\.[^/]+)?$/
const COMMITTABLE_ENV = /^\.env\.example$/i

function walkTree(reader: TreeReader): Walk {
  const files: WalkedFile[] = []
  const findings: string[] = []
  const trees = new Map<string, ts.SourceFile>()
  let envSkipped = 0
  const pending: string[] = [REPO_DIR]
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let entries: readonly DirEntry[]
    try {
      entries = reader.list(dir)
    } catch {
      findings.push(`unreadable ${dir === '' ? '.' : dir}`)
      continue
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      // Refused before any read, and never named in output.
      if (entry.name.toLowerCase().startsWith('.env')) {
        const ignored = GITIGNORED_ENV.test(entry.name) && !COMMITTABLE_ENV.test(entry.name)
        if (entry.kind === 'file' && ignored) envSkipped += 1
        else findings.push(`env-named-entry ${dir === '' ? '.' : dir}`)
        continue
      }
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      // The repository root (review fix SEC2-6): excluded by name whatever the kind, two folders
      // walked, three files read as text, any other entry a finding that is never read.
      if (dir === REPO_DIR) {
        const walked = ROOT_WALKED.get(entry.name)
        if (ROOT_EXCLUDED.has(entry.name)) continue
        if (walked !== undefined && entry.kind === 'dir') {
          pending.push(walked)
        } else if (ROOT_TEXT.has(entry.name) && entry.kind === 'file') {
          try {
            const text = reader.read(path)
            files.push({ path, cls: 'text', ext: extensionOf(entry.name) ?? '', text })
          } catch {
            findings.push(`unreadable ${path}`)
          }
        } else if (entry.kind === 'dir') {
          findings.push(`unknown-folder ${entry.name}`)
        } else if (entry.kind === 'file') {
          findings.push(`unknown-extension ${extensionOf(entry.name) ?? '(none)'}`)
        } else {
          findings.push(`unreadable ${path}`)
        }
        continue
      }
      // The exclusions are by name, whatever the entry's kind (a linked node_modules included).
      if (dir === '' && (TOP_EXCLUDED.has(entry.name) || ROOT_FILES_EXCLUDED.has(entry.name))) {
        continue
      }
      if (NESTED_EXCLUDED.has(path)) continue
      if (
        entry.kind === 'dir' &&
        path.startsWith(`${REPO_DIR}/`) &&
        ROOT_NESTED_EXCLUDED.has(path.slice(REPO_DIR.length + 1))
      ) {
        continue
      }
      if (entry.kind === 'dir') {
        if (dir === '' && !TOP_WALKED.has(entry.name)) {
          findings.push(`unknown-folder ${entry.name}`)
          continue
        }
        pending.push(path)
        continue
      }
      // A link, socket or device is not followed: fail closed.
      if (entry.kind !== 'file') {
        findings.push(`unreadable ${path}`)
        continue
      }
      if (isRunnerTest(path)) continue
      const classified = classify(entry.name)
      if ('unknown' in classified) {
        findings.push(`unknown-extension ${classified.unknown}`)
        continue
      }
      if (classified.cls === 'inert') {
        files.push({ path, cls: 'inert', ext: classified.ext, text: null })
        continue
      }
      let text: string
      try {
        text = reader.read(path)
      } catch {
        findings.push(`unreadable ${path}`)
        continue
      }
      if (classified.cls === 'script') {
        const tree = ts.createSourceFile(
          path,
          text,
          ts.ScriptTarget.Latest,
          true,
          scriptKindOf(path),
        )
        trees.set(path, tree)
        const errors = syntaxErrorsOf(tree)
        if (errors === null || errors > 0) findings.push(`parse-error ${path}`)
      }
      files.push({ path, cls: classified.cls, ext: classified.ext, text })
    }
  }
  if (!files.some((file) => file.text !== null)) findings.push('empty-walk')
  return { files, findings, trees, envSkipped }
}

/** A reason that says gitignored (and not "not gitignored"): FS0e g11 checks it against .gitignore. */
const SAYS_GITIGNORED = /(?<!not )\bgitignored\b/

/**
 * The excluded names whose reason says gitignored, and those of them the root .gitignore, read
 * through `reader` as `../.gitignore`, does not ignore whole (lead decision §20, SEC3-2 option b).
 * Names are relative to the repository root, as the patterns are. A line ignores a name whole when,
 * with one leading `/` (or a leading `**` and `/`) and one trailing `/` taken off, it is exactly
 * the name (at the root, or at any depth). The last line that names it decides, so a negated line
 * (`!name`) does not count and re-includes it, and so does any negation git could read as the name
 * (mayReinclude). Trailing spaces are dropped and CRLF line ends read, as git does. Another case, a
 * wildcard, a deeper path or a comment does not count (fail closed). An unreadable .gitignore leaves
 * every checked name a gap, and so does a .gitignore on the way to a nested name (ignoreFileOnTheWay).
 */
function gitignoreGaps(
  reader: TreeReader,
  excluded: ReadonlyMap<string, string>,
): { checked: string[]; gaps: string[] } {
  const checked = [...excluded]
    .filter(([, reason]) => SAYS_GITIGNORED.test(reason))
    .map(([name]) => name)
    .sort()
  let lines: string[]
  try {
    lines = reader
      .read(`${REPO_DIR}/.gitignore`)
      .split(/\r?\n/)
      .map((line) => line.replace(/ +$/, ''))
  } catch {
    return { checked, gaps: checked }
  }
  const gaps = checked.filter((name) => {
    let ignored = false
    for (const line of lines) {
      const negated = line.startsWith('!')
      const pattern = (negated ? line.slice(1) : line)
        .replace(/^(?:\/|\*\*\/)/, '')
        .replace(/\/$/, '')
      if (pattern === name) ignored = !negated
      else if (negated && mayReinclude(line.slice(1), name)) ignored = false
    }
    return !ignored || ignoreFileOnTheWay(reader, name)
  })
  return { checked, gaps }
}

/**
 * Whether git could read a negated pattern (its `!` taken off) as naming `name`, so that it
 * re-includes it (review fix SEC5-1; each form probed with git check-ignore). A wildcard, a class or
 * an escape always could (fail closed). With no `/` but a trailing one, the pattern names a basename
 * at any depth; with a leading or inner `/`, the path from the root. Compared in any case, because
 * git with core.ignorecase (Windows) reads a negation in any case.
 */
function mayReinclude(pattern: string, name: string): boolean {
  if (/[*?[\\]/.test(pattern)) return true
  const path = pattern.replace(/\/$/, '')
  const anchored = path.includes('/')
  const target = anchored ? path.replace(/^\//, '') : path
  const subject = anchored ? name : name.slice(name.lastIndexOf('/') + 1)
  return target.toLowerCase() === subject.toLowerCase()
}

/**
 * Whether a `.gitignore` may sit in a folder between the repository root and a nested name (review
 * fix SEC5-2): git reads a lower .gitignore over the root one, so a file there could re-include the
 * name. Fail closed: one in any case (Windows opens `.GITIGNORE` as `.gitignore`) and of any kind, or
 * a folder on the way that cannot be listed. An absent folder holds none (CI's checkout has no
 * docs/), and git never reads a .gitignore inside the ignored folder itself.
 */
function ignoreFileOnTheWay(reader: TreeReader, name: string): boolean {
  let dir = REPO_DIR
  for (const part of name.split('/').slice(0, -1)) {
    try {
      const folder = reader.list(dir).find((entry) => entry.name === part)
      if (folder?.kind !== 'dir') return false
      dir = `${dir}/${part}`
      if (reader.list(dir).some((entry) => entry.name.toLowerCase() === '.gitignore')) return true
    } catch {
      return true
    }
  }
  return false
}

// ---- script tokens (one AST visit per script, shared by the reach walk and the scans) ----

interface Token {
  readonly value: string
  readonly line: number
}

interface ScriptTokens {
  /** Cooked string and template literals, template parts included. */
  readonly literals: readonly Token[]
  /** String and no-substitution template literals only (the equality forms). */
  readonly exactLiterals: readonly Token[]
  /** Regex literal patterns, escapes resolved. */
  readonly regexes: readonly Token[]
  readonly identifiers: readonly Token[]
  /** Object-literal property names (identifier, string, computed literal, shorthand, method). */
  readonly propertyNames: readonly Token[]
  /** Module specifiers: import, export from, import-equals, require(), import(), import types. */
  readonly specifiers: readonly Token[]
  /** Lines of the S3 forms. */
  readonly reveals: readonly number[]
  /** Lines that write the global fetch or its dispatcher (S3 form fetch). */
  readonly fetchWrites: readonly number[]
}

/** A regex literal's pattern with \xHH, \uHHHH, \u{H} and escaped punctuation resolved. */
function regexText(literal: string): string {
  const pattern = literal.slice(1, literal.lastIndexOf('/'))
  return pattern.replace(
    /\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([^0-9a-z]))/gi,
    (whole: string, braced?: string, unicode?: string, hex?: string, char?: string) => {
      if (char !== undefined) return char
      const code = parseInt(braced ?? unicode ?? hex ?? '', 16)
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    },
  )
}

const isTextLiteral = (
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/** The text of a property or binding name: identifier, string, number or computed literal. */
function nameText(name: ts.Node | undefined): string | undefined {
  if (name === undefined) return undefined
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return ts.idText(name)
  if (isTextLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name) && isTextLiteral(name.expression)) return name.expression.text
  return undefined
}

/** True for an object literal that is the target (or inside the target) of a destructuring assignment. */
function isAssignmentTarget(node: ts.Node): boolean {
  let child: ts.Node = node
  let parent: ts.Node | undefined = node.parent
  while (parent !== undefined) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isObjectLiteralExpression(parent)
    ) {
      child = parent
      parent = parent.parent
      continue
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
      child = parent.parent
      parent = parent.parent.parent
      continue
    }
    if (ts.isBinaryExpression(parent)) {
      return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === child
    }
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      return parent.initializer === child
    }
    return false
  }
  return false
}

const REVEAL = 'reveal'
const FETCH = 'fetch'

/** `fetch`, `x.fetch` or `x['fetch']`: a name the global fetch can be written through (any object). */
function namesFetch(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return ts.idText(node) === FETCH
  if (ts.isPropertyAccessExpression(node)) return ts.idText(node.name) === FETCH
  return (
    ts.isElementAccessExpression(node) &&
    isTextLiteral(node.argumentExpression) &&
    node.argumentExpression.text === FETCH
  )
}

/** True when `node` is written: the left side of any assignment, or inside a destructuring target. */
function isWritten(node: ts.Node): boolean {
  let child: ts.Node = node
  let parent: ts.Node | undefined = node.parent
  while (parent !== undefined && ts.isParenthesizedExpression(parent)) {
    child = parent
    parent = parent.parent
  }
  if (parent !== undefined && ts.isBinaryExpression(parent) && parent.left === child) {
    const operator = parent.operatorToken.kind
    if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) {
      return true
    }
  }
  if (parent !== undefined && ts.isShorthandPropertyAssignment(parent)) {
    return isAssignmentTarget(parent.parent)
  }
  return isAssignmentTarget(node)
}

/** The Reflect and Object helpers that can write a property by a literal name. */
const WRITE_HELPERS: ReadonlySet<string> = new Set([
  'assign',
  'defineProperties',
  'defineProperty',
  'set',
])

function tokensOf(tree: ts.SourceFile): ScriptTokens {
  const literals: Token[] = []
  const exactLiterals: Token[] = []
  const regexes: Token[] = []
  const identifiers: Token[] = []
  const propertyNames: Token[] = []
  const specifiers: Token[] = []
  const reveals: number[] = []
  const fetchWrites: number[] = []
  const lineOf = (node: ts.Node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
  const specifier = (node: ts.Node | undefined): void => {
    if (node !== undefined && isTextLiteral(node)) {
      specifiers.push({ value: node.text, line: lineOf(node) })
    }
  }
  const visit = (node: ts.Node): void => {
    // Literals, regexes and names.
    if (isTextLiteral(node)) {
      literals.push({ value: node.text, line: lineOf(node) })
      exactLiterals.push({ value: node.text, line: lineOf(node) })
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      literals.push({ value: node.text, line: lineOf(node) })
    } else if (ts.isRegularExpressionLiteral(node)) {
      regexes.push({ value: regexText(node.text), line: lineOf(node) })
    } else if (ts.isIdentifier(node)) {
      identifiers.push({ value: ts.idText(node), line: lineOf(node) })
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = 'name' in property ? nameText(property.name) : undefined
        if (name !== undefined) propertyNames.push({ value: name, line: lineOf(property) })
      }
    }
    // Module specifiers (the reach walk's forms, catalogue class 12).
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifier(node.moduleReference.expression)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifier(node.arguments[0])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier(node.argument.literal)
    }
    // S3: Secret.reveal (§3.13.3; CRIT-4).
    if (ts.isPropertyAccessExpression(node) && ts.idText(node.name) === REVEAL) {
      reveals.push(lineOf(node))
    } else if (
      ts.isElementAccessExpression(node) &&
      isTextLiteral(node.argumentExpression) &&
      node.argumentExpression.text === REVEAL
    ) {
      reveals.push(lineOf(node))
    } else if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      nameText(node.propertyName ?? node.name) === REVEAL
    ) {
      reveals.push(lineOf(node))
    } else if (ts.isObjectLiteralExpression(node) && isAssignmentTarget(node)) {
      for (const property of node.properties) {
        if (
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          nameText(property.name) === REVEAL
        ) {
          reveals.push(lineOf(property))
        }
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const owner = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      const base = owner ? callee.expression : undefined
      if (
        base !== undefined &&
        ts.isIdentifier(base) &&
        (base.text === 'Reflect' || base.text === 'Object') &&
        node.arguments.some((argument) => isTextLiteral(argument) && argument.text === REVEAL)
      ) {
        reveals.push(lineOf(node))
      }
    }
    // S3 form fetch (review fix SEC2-8): a write to the global fetch or its dispatcher captures the
    // headers of every request, the apikey included (§3.11, CRIT-12's reason to refuse fetchImpl on
    // https): an assignment to `fetch`, `x.fetch` or `x['fetch']` (destructuring included), a Reflect
    // or Object helper that writes a property named fetch, `stubGlobal('fetch', …)`, undici's
    // setGlobalDispatcher, or the dispatcher's global symbol name.
    if (namesFetch(node) && isWritten(node)) fetchWrites.push(lineOf(node))
    if (ts.isIdentifier(node) && ts.idText(node) === 'setGlobalDispatcher') {
      fetchWrites.push(lineOf(node))
    }
    if (isTextLiteral(node) && /undici\.globaldispatcher/i.test(node.text)) {
      fetchWrites.push(lineOf(node))
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const owned = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
      const method = ts.isPropertyAccessExpression(callee)
        ? ts.idText(callee.name)
        : ts.isElementAccessExpression(callee) && isTextLiteral(callee.argumentExpression)
          ? callee.argumentExpression.text
          : ts.isIdentifier(callee)
            ? ts.idText(callee)
            : undefined
      const helper =
        owned &&
        ts.isIdentifier(callee.expression) &&
        (callee.expression.text === 'Reflect' || callee.expression.text === 'Object') &&
        method !== undefined &&
        WRITE_HELPERS.has(method)
      const namesFetchArgument = node.arguments.some(
        (argument) =>
          (isTextLiteral(argument) && argument.text === FETCH) ||
          (ts.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property) => 'name' in property && nameText(property.name) === FETCH,
            )),
      )
      if (namesFetchArgument && (helper || method === 'stubGlobal')) {
        fetchWrites.push(lineOf(node))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return {
    literals,
    exactLiterals,
    regexes,
    identifiers,
    propertyNames,
    specifiers,
    reveals,
    fetchWrites,
  }
}

/** One token cache per walk. */
function tokenCache(walk: Walk): (path: string) => ScriptTokens | null {
  const cache = new Map<string, ScriptTokens>()
  return (path) => {
    const tree = walk.trees.get(path)
    if (tree === undefined) return null
    let tokens = cache.get(path)
    if (tokens === undefined) {
      tokens = tokensOf(tree)
      cache.set(path, tokens)
    }
    return tokens
  }
}

// ---- the reach walk (copied from scripts/testing/staging-catalogue.test.ts:1359-1582; FW) ----

/** The extensions a specifier may leave out, in TypeScript's order, and a .json. */
const LOADABLE = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const
/** A loaded file the walk reads for what it loads in turn (any letter case). */
const WALKED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i

/** Walked files by '/' path, found in any letter case (Windows loads them). */
interface RepoFiles {
  readonly find: (path: string) => string | undefined
}

function repoFilesOf(walk: Walk): RepoFiles {
  const byLower = new Map(walk.files.map((file) => [file.path.toLowerCase(), file.path]))
  return { find: (path) => byLower.get(path.toLowerCase()) }
}

/** tsconfig.json's path aliases as [prefix, folder]: '@/*' to './src/*' is ['@/', 'src/']. */
function aliasesOf(root = ROOT): readonly (readonly [string, string])[] {
  const read = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  const config = read.config as { compilerOptions?: { paths?: Record<string, string[]> } }
  return Object.entries(config.compilerOptions?.paths ?? {}).map(([key, targets]) => {
    const target = targets[0] ?? ''
    if (!key.endsWith('/*') || targets.length !== 1 || !target.endsWith('/*')) {
      throw new Error(`tsconfig paths: ${key} is not one 'x/*' to 'y/*', which the walk follows`)
    }
    return [key.slice(0, -1), posix.normalize(target.slice(0, -1))] as const
  })
}

const ALIASES = aliasesOf()

type Resolved =
  { readonly file: string } | { readonly external: true } | { readonly problem: string }

const TS_FOR_JS: Readonly<Record<string, string>> = {
  js: '.ts',
  jsx: '.tsx',
  mjs: '.mts',
  cjs: '.cts',
}

/** The file `specifier` loads from `from`: relative, alias and index forms; a package is external. */
function resolveFrom(
  from: string,
  specifier: string,
  files: RepoFiles,
  aliases: readonly (readonly [string, string])[] = ALIASES,
): Resolved {
  const spec = specifier.replace(/\\/g, '/')
  const alias = aliases.find(([prefix]) => spec.startsWith(prefix))
  let base: string
  if (alias !== undefined) base = alias[1] + spec.slice(alias[0].length)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    base = posix.join(posix.dirname(from), spec)
  } else if (spec.startsWith('/') || /^[a-z]:\//i.test(spec) || /^file:/i.test(spec)) {
    return { problem: `loads '${specifier}' by an absolute path or URL` }
  } else return { external: true }
  const stem = posix.normalize(base).replace(/\/$/, '')
  if (stem === '..' || stem.startsWith('../')) {
    return { problem: `loads '${specifier}', outside the repository` }
  }
  const swapped = stem.replace(
    /\.(js|jsx|mjs|cjs)$/i,
    (whole, ext: string) => TS_FOR_JS[ext.toLowerCase()] ?? whole,
  )
  for (const candidate of [
    stem,
    swapped,
    ...LOADABLE.map((ext) => stem + ext),
    ...LOADABLE.map((ext) => `${stem}/index${ext}`),
  ]) {
    const file = files.find(candidate)
    if (file !== undefined) return { file }
  }
  return { problem: `cannot follow '${specifier}'` }
}

/**
 * A string literal that names a file by a relative or alias path (review fix SEC-1). Loads the
 * specifier forms do not see take such a literal: `createRequire(import.meta.url)('…')`,
 * `module.require('…')`, `require.call(null, '…')`, `(require)('…')`, `globalThis.require('…')`,
 * `import.meta.resolve('…')`, `new Worker(new URL('…', import.meta.url))`, and a specifier held in
 * a const. A literal that resolves to a repository file is an edge; one that does not is ignored
 * (it is a path string, not a load). A name assembled at run time is a documented limit (FW2 g4).
 */
function isPathLiteral(value: string, aliases = ALIASES): boolean {
  const text = value.replace(/\\/g, '/')
  return (
    text.startsWith('./') || text.startsWith('../') || aliases.some(([p]) => text.startsWith(p))
  )
}

/** A file name at storyboard/'s top, so a path literal also resolves from the working directory. */
const FROM_ROOT = '(working directory)'

/** Each file `entry` loads, directly or through others, with the file that first loaded it. */
function reachOf(
  entry: string,
  files: RepoFiles,
  tokens: (path: string) => ScriptTokens | null,
): { parents: Map<string, string | null>; problems: string[] } {
  const parents = new Map<string, string | null>([[entry, null]])
  const problems: string[] = []
  const queue = [entry]
  const edge = (from: string, to: string) => {
    if (!parents.has(to)) {
      parents.set(to, from)
      queue.push(to)
    }
  }
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (!WALKED.test(file)) continue
    const fileTokens = tokens(file)
    for (const { value: specifier } of fileTokens?.specifiers ?? []) {
      const resolved = resolveFrom(file, specifier, files)
      if ('external' in resolved) continue
      if ('problem' in resolved) {
        problems.push(`${file}: ${resolved.problem}`)
        continue
      }
      edge(file, resolved.file)
    }
    for (const { value } of fileTokens?.exactLiterals ?? []) {
      if (!isPathLiteral(value)) continue
      // From the file's folder, and from storyboard/ (review fix SEC2-4): `new Worker('./…')`,
      // `fork('./…')` and spawn arguments resolve against the working directory, storyboard/.
      for (const from of [file, FROM_ROOT]) {
        const resolved = resolveFrom(from, value, files)
        if ('file' in resolved) edge(file, resolved.file)
      }
    }
  }
  return { parents, problems }
}

interface ReachFence {
  readonly name: string
  readonly file: string
  readonly allowed: (entry: string) => boolean
}

/** F1's allow-list: owner item 1 option 1 (lead decision 15). Step 14 adds its CLI. */
const F1_ALLOWED: ReadonlySet<string> = new Set([
  'tools/publisher/content-deleter.ts',
  'tools/publisher/cli.ts',
])

const REACH_FENCES: readonly ReachFence[] = [
  {
    name: 'F1 storage client',
    file: 'tools/publisher/storage.ts',
    allowed: (entry) => entry === 'tools/publisher/storage.ts' || F1_ALLOWED.has(entry),
  },
  {
    name: 'F2 env',
    file: 'tools/publisher/env.ts',
    allowed: (entry) => entry.startsWith('tools/publisher/'),
  },
  {
    name: 'F3 storage stub',
    file: 'tools/publisher/storage-stub.ts',
    allowed: (entry) => entry === 'tools/publisher/storage-stub.ts',
  },
  {
    // F4's reviewed row (Step 15b, p1-step15b-design.md D15B-14): the deleter and its first caller.
    name: 'F4 content deleter',
    file: 'tools/publisher/content-deleter.ts',
    allowed: (entry) =>
      entry === 'tools/publisher/content-deleter.ts' || entry === 'tools/publisher/cli.ts',
  },
  {
    name: 'F5 deploy hook',
    file: 'tools/publisher/hook.ts',
    allowed: (entry) => entry === 'tools/publisher/hook.ts' || entry === 'tools/publisher/cli.ts',
  },
  {
    name: 'F6 verify',
    file: 'tools/publisher/verify.ts',
    allowed: (entry) => entry === 'tools/publisher/verify.ts' || entry === 'tools/publisher/cli.ts',
  },
]

/** The entries: every non-test script the walker lists. */
const entriesOf = (walk: Walk): string[] =>
  walk.files.filter((file) => file.cls === 'script').map((file) => file.path)

/** An entry that reaches a fenced module it is not allowed to (with the chain), and what it could not follow. */
function reachFindings(walk: Walk, tokens: (path: string) => ScriptTokens | null): string[] {
  const files = repoFilesOf(walk)
  const findings = new Set<string>()
  for (const entry of entriesOf(walk)) {
    const { parents, problems } = reachOf(entry, files, tokens)
    for (const problem of problems) findings.add(`${problem} (reached from ${entry})`)
    for (const fence of REACH_FENCES) {
      const hit = [...parents.keys()].find((file) => file.toLowerCase() === fence.file)
      if (hit === undefined || fence.allowed(entry)) continue
      const chain: string[] = []
      for (let file: string | null | undefined = hit; file; file = parents.get(file)) {
        chain.unshift(file)
      }
      findings.add(`${entry}: loads the ${fence.name} module (${chain.join(' > ')})`)
    }
  }
  return [...findings]
}

// ---- the scans S1, S2 and S3 (§3.13.3) ----

type FormId =
  | 's1-route'
  | 's1-supabase'
  | 's1-cli'
  | 's1-apikey'
  | 's1-upsert'
  | 's2-name'
  | 's2-marker'
  | 's2-env-file'
  | 's2-yaml'
  | 's3-reveal'
  | 's3-fetch'
  | 'fw-path'

interface Hit {
  readonly path: string
  readonly line: number
  readonly form: FormId
}

/**
 * S1 form a on one text: `storage`, slashes, `v1` not followed by a letter or digit, anywhere (no
 * trailing slash is needed: `${base}/object/…` builds on a base that ends in `v1`; review fix SEC-2),
 * except a public object path with no traversal in it.
 */
function holdsRouteText(text: string): boolean {
  for (const match of text.matchAll(/storage\/+v1(?![0-9a-z])/gi)) {
    const after = text.slice(match.index + match[0].length)
    if (after.startsWith('/object/public/')) {
      const rest = after.slice('/object/public/'.length).split(/[\s'"`<>(),;]/)[0] ?? ''
      if (!/\.\.|%2e|%2f|%5c|\\/i.test(rest)) continue
    }
    return true
  }
  return false
}

/**
 * The path a WHATWG URL parser sends for `text` (Node's fetch and URL): `.` and `..` segments and
 * `%2e%2e` resolved, `\` turned into `/`, tab and newline dropped; then every %XX escape decoded.
 * '' when it does not parse.
 */
function parsedPathOf(text: string): string {
  let pathname: string
  try {
    pathname = new URL(text, 'http://x.invalid/').pathname
  } catch {
    return ''
  }
  return pathname.replace(/%([0-9a-f]{2})/gi, (_whole, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
}

/**
 * S1 form a (review fix SEC-2, guard-bypass catalogue path class 4): the text itself, and the path a
 * URL parser makes of the whole text and of each word in it (a `?` or `#` earlier on a line cannot
 * hide a later word). Only a text holding a `v` or `%` and an `s` or `%` can parse to the route.
 */
function holdsRoute(text: string): boolean {
  if (holdsRouteText(text)) return true
  return [text, ...text.split(/[\s'"`]+/)].some(
    (part) => /[v%]/i.test(part) && /[s%]/i.test(part) && holdsRouteText(parsedPathOf(part)),
  )
}

/** S1 form c: `ss:///`, or `supabase`, optional flags, then `storage ls|cp|mv|rm`, as words. */
const CLI =
  /ss:\/\/\/|\bsupabase(?:\s+--?[a-z][\w-]*(?:=\S*|\s+(?!-|storage\b)\S+)?)*\s+storage\s+(?:ls|cp|mv|rm)\b/i
/**
 * S1 form d in text files: `apikey`, an optional quote, optional spaces and a colon or an `=` (a
 * PowerShell hashtable `@{ apikey = $k }`, a Python `dict(apikey=k)`; review fix SEC-5).
 */
const APIKEY_TEXT = /(?<![\w-])apikey["']?\s*[:=]/i
const UPSERT = /x-upsert/i
const KEY_NAME = /supabase_secret_key/i
const KEY_MARKER = /sb_secret/i
/** S2 env-file in a script literal: `.env` starting a path segment, then the end or a dot. */
const ENV_FILE_LITERAL = /(?:^|[/\\])\.env(?:$|\.)/i
/** S2 env-file in a text file that can run. */
const ENV_FILE_TEXT = /--env-file|loadenvfile|dotenv|(?:^|[\s'"=/\\])\.env(?=$|[\s.'"])/i
const ENV_FILE_FLAG = /--env-file/i
const DOTENV_SPECIFIER = /^(?:dotenv(?:\/|$)|@dotenvx\/)/i
const SUPABASE_SPECIFIER = /^@supabase\//i
const YAML_SECRETS = [
  /tojson\(\s*secrets\s*\)/i,
  /\bsecrets\s*\[/i,
  /\bsecrets:\s*inherit\b/i,
  /\$\{\{\s*secrets\s*\}\}/i,
] as const
/**
 * S2 YAML (review fix SEC-3, catalogue class 10): inside `${{ … }}`, the whole `secrets` or `env`
 * object, that is any use not followed by `.NAME`: `toJSON(secrets.*)`, `join(secrets.*, ',')`,
 * `(secrets)`, `secrets || ''`, `toJSON(env)`. Each expands to every value without naming one.
 */
const YAML_OBJECT = /(?<![.\w-])(?:secrets|env)(?![\w-])(?!\s*\.\s*[a-z_])/i
const holdsYamlObject = (line: string) =>
  [...line.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some((span) => YAML_OBJECT.test(span[1] ?? ''))

/**
 * The text a runnable text file's line passes on once the shell, PowerShell or cmd has run over it
 * (review fix SEC2-5): `"$U/storage"/v1/…`, `"$U"/'storage'/v1/…` and `"$U/stor""age/v1/…"` all send
 * to /storage/v1/…. Quotes are dropped in every runnable text file, PowerShell's backtick escape in
 * .ps1 and .psm1, and cmd's caret escape in .cmd and .bat.
 */
function unquoted(text: string, ext: string): string {
  let plain = text.replace(/["']/g, '')
  if (ext === 'ps1' || ext === 'psm1') plain = plain.replaceAll('`', '')
  if (ext === 'cmd' || ext === 'bat') plain = plain.replaceAll('^', '')
  return plain
}

/**
 * Form fw-path (review fix SEC2-4): a fenced module named by its repository path, in a script literal
 * or a line of runnable text, by a file its fence (F1-F6) does not allow. The loads the reach walk
 * cannot follow take such a path: spawn and execFile arguments, `node -e` and eval code, a Worker with
 * `eval: true`, a workflow `run:` line, a package.json script. F4's reviewed row (Step 15b) allows
 * content-deleter.ts and cli.ts, as in the reach walk.
 */
const FENCED_PATH =
  /tools[\\/]+publisher[\\/]+(storage-stub|storage|content-deleter|env)(?![\w-])/gi

function namesFencedModule(text: string, path: string): boolean {
  for (const match of text.matchAll(FENCED_PATH)) {
    const file = `tools/publisher/${(match[1] ?? '').toLowerCase()}.ts`
    const fence = REACH_FENCES.find((candidate) => candidate.file === file)
    if (fence !== undefined && !fence.allowed(path.replaceAll('\\', '/'))) return true
  }
  return false
}

/** The JSON string tokens of a line, decoded (a token that does not decode is skipped). */
function jsonStringsOf(line: string): string[] {
  const decoded: string[] = []
  for (const match of line.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    try {
      const value: unknown = JSON.parse(match[0])
      if (typeof value === 'string') decoded.push(value)
    } catch {
      // Not a JSON string: the raw line is still read.
    }
  }
  return decoded
}

function hitsOf(file: WalkedFile, tokens: ScriptTokens | null): Hit[] {
  const hits = new Map<string, Hit>()
  const add = (line: number, form: FormId) =>
    hits.set(`${line} ${form}`, { path: file.path, line, form })
  const textForms = (value: string, line: number) => {
    if (holdsRoute(value)) add(line, 's1-route')
    if (CLI.test(value)) add(line, 's1-cli')
    if (UPSERT.test(value)) add(line, 's1-upsert')
    if (KEY_NAME.test(value)) add(line, 's2-name')
    if (KEY_MARKER.test(value)) add(line, 's2-marker')
  }
  const runnable = file.cls === 'text' && RUNNABLE_TEXT.has(file.ext)
  const yaml = file.ext === 'yml' || file.ext === 'yaml'
  for (const [index, raw] of (file.text ?? '').split('\n').entries()) {
    const line = index + 1
    textForms(raw, line) // raw text, comments included
    if (file.cls !== 'text') continue
    const decoded = jsonStringsOf(raw)
    // Runnable text is also read as it runs: quotes and escapes removed (review fix SEC2-5).
    const views = runnable ? [raw, unquoted(raw, file.ext)] : [raw]
    const values = runnable
      ? [...decoded, ...decoded.map((value) => unquoted(value, file.ext))]
      : decoded
    for (const view of views) {
      if (view !== raw) textForms(view, line)
      if (APIKEY_TEXT.test(view)) add(line, 's1-apikey')
      if (runnable && ENV_FILE_TEXT.test(view)) add(line, 's2-env-file')
      if (yaml && (YAML_SECRETS.some((pattern) => pattern.test(view)) || holdsYamlObject(view))) {
        add(line, 's2-yaml')
      }
      if (runnable && namesFencedModule(view, file.path)) add(line, 'fw-path')
    }
    for (const value of values) {
      textForms(value, line)
      if (APIKEY_TEXT.test(value)) add(line, 's1-apikey')
      if (runnable && ENV_FILE_TEXT.test(value)) add(line, 's2-env-file')
      if (runnable && namesFencedModule(value, file.path)) add(line, 'fw-path')
    }
  }
  if (tokens !== null) {
    for (const { value, line } of tokens.literals) {
      textForms(value, line)
      if (ENV_FILE_LITERAL.test(value) || ENV_FILE_FLAG.test(value)) add(line, 's2-env-file')
      if (namesFencedModule(value, file.path)) add(line, 'fw-path')
    }
    for (const { value, line } of tokens.exactLiterals) {
      if (value.toLowerCase() === 'apikey') add(line, 's1-apikey')
      if (value.toLowerCase() === 'loadenvfile') add(line, 's2-env-file')
    }
    for (const { value, line } of tokens.regexes) {
      if (KEY_MARKER.test(value)) add(line, 's2-marker')
    }
    for (const { value, line } of tokens.identifiers) {
      if (value.toLowerCase() === 'loadenvfile') add(line, 's2-env-file')
    }
    for (const { value, line } of tokens.propertyNames) {
      if (value.toLowerCase() === 'apikey') add(line, 's1-apikey')
    }
    for (const { value, line } of tokens.specifiers) {
      if (SUPABASE_SPECIFIER.test(value)) add(line, 's1-supabase')
      if (DOTENV_SPECIFIER.test(value)) add(line, 's2-env-file')
    }
    for (const line of tokens.reveals) add(line, 's3-reveal')
    for (const line of tokens.fetchWrites) add(line, 's3-fetch')
  }
  return [...hits.values()]
}

// ---- the allow-list (§3.13.4: the one table, AUD-11) ----

type Allowance = 'allowed' | 'must-hold'

const ALLOW_TABLE: ReadonlyMap<string, Partial<Record<FormId, Allowance>>> = new Map([
  [
    'tools/publisher/storage.ts',
    {
      's1-route': 'must-hold',
      's1-apikey': 'must-hold',
      's1-upsert': 'must-hold',
      's3-reveal': 'must-hold',
    },
  ],
  [
    'tools/publisher/storage-stub.ts',
    { 's1-route': 'must-hold', 's1-apikey': 'allowed', 's1-upsert': 'must-hold' },
  ],
  [
    'tools/publisher/content-deleter.ts',
    { 's1-route': 'must-hold', 's1-apikey': 'must-hold', 's3-reveal': 'must-hold' },
  ],
  [
    'tools/publisher/env.ts',
    { 's2-name': 'must-hold', 's2-marker': 'must-hold', 's2-env-file': 'must-hold' },
  ],
  ['tools/publisher/hook.ts', { 's3-reveal': 'must-hold' }],
  // Lead decision 3: narration reads its own Azure keys from the env file; it reaches no Storage
  // client (F1) and holds no Storage route (S1), so only the env-file form is allowed here.
  ['tools/narration/cli.ts', { 's2-env-file': 'must-hold' }],
  // Step 14 (design p1-step14-design.md §3.15 edit 2): the publisher CLI loads the env file through
  // env.ts on exactly two pinned lines (FS2a g4); the narration precedent above.
  ['tools/publisher/cli.ts', { 's2-env-file': 'must-hold' }],
  ['.github/workflows/keep-alive.yml', { 's1-route': 'must-hold', 's1-apikey': 'must-hold' }],
])

/** Every allow-list compare turns '\' into '/' first, then compares the exact path (FS6). */
const normalPath = (path: string) => path.replaceAll('\\', '/')

function allowanceOf(path: string, form: FormId): Allowance | undefined {
  return ALLOW_TABLE.get(normalPath(path))?.[form]
}

const findingOf = (hit: Hit) => `${normalPath(hit.path)}:${hit.line} ${hit.form}`

interface Scan {
  readonly walk: Walk
  readonly hits: readonly Hit[]
  /** Hits outside the allow-list, as `path:line form-id`. */
  readonly findings: readonly string[]
  readonly tokens: (path: string) => ScriptTokens | null
}

function scanWalk(walk: Walk): Scan {
  const tokens = tokenCache(walk)
  const hits = walk.files.flatMap((file) =>
    file.text === null ? [] : hitsOf(file, tokens(file.path)),
  )
  const findings = hits
    .filter((hit) => allowanceOf(hit.path, hit.form) === undefined)
    .map(findingOf)
  return { walk, hits, findings, tokens }
}

/** Runs in-memory files through the same walker and scans as the real tree. */
function scanFiles(files: Readonly<Record<string, MemoryFile>>): Scan & { reads: string[] } {
  const reads: string[] = []
  return { ...scanWalk(walkTree(memoryReader(files, reads))), reads }
}

/** The must-hold cells of the table with no hit in the scanned files: `path form-id`. */
function unusedAllowances(hits: readonly Hit[], prefix: 's1' | 's2' | 's3'): string[] {
  const unused: string[] = []
  for (const [path, forms] of ALLOW_TABLE) {
    for (const [form, allowance] of Object.entries(forms)) {
      if (allowance !== 'must-hold' || !form.startsWith(prefix)) continue
      if (!hits.some((hit) => normalPath(hit.path) === path && hit.form === form)) {
        unused.push(`${path} ${form}`)
      }
    }
  }
  return unused
}

// ---- the samples (module level, so FS5 can check every finding they produce) ----

/** [id, path, text, the form it must give, or null when it must give no finding]. */
type Sample = readonly [id: string, path: string, text: string, form: FormId | null]

const ROUTE_SAMPLES: readonly Sample[] = [
  ['r1', 'scripts/x.ts', "export const u = '/storage/v1/object/sign/masters/x'", 's1-route'],
  ['r2', 'scripts/x.ts', "export const u = '/STORAGE/V1/OBJECT/MOVE'", 's1-route'],
  [
    'r3',
    'scripts/x.ts',
    'export const u = (o: string) => `${o}/storage/v1/object/copy`',
    's1-route',
  ],
  ['r4', 'scripts/x.ts', "export const u = '/storage/v1/' + 'object/copy'", 's1-route'],
  ['r5', 'scripts/x.ts', "export const u = '/storage\\u002fv1/object/list/masters'", 's1-route'],
  ['r6', 'scripts/x.json', '{ "u": "/storage/v1/object/move" }', 's1-route'],
  ['r7', 'scripts/x.json', '{ "u": "\\/storage\\/v1\\/object" }', 's1-route'],
  [
    'r8',
    'scripts/x.ts',
    "export const u = '/storage/v1/object/public/../authenticated/masters/x'",
    's1-route',
  ],
  ['r9', 'scripts/x.ts', "export const u = '/storage/v1/object/public/%2e%2e/sign/x'", 's1-route'],
  ['r10', 'scripts/x.ts', "export const u = '/storage/v1/object/public\\\\..\\\\x'", 's1-route'],
  // One sample per unsafe token inside a public path, each alone.
  [
    'r9b',
    'scripts/x.ts',
    "export const u = '/storage/v1/object/public/content%2fsign'",
    's1-route',
  ],
  [
    'r10b',
    'scripts/x.ts',
    "export const u = '/storage/v1/object/public/content\\\\x\\\\authenticated'",
    's1-route',
  ],
  ['r10c', 'scripts/x.ts', "export const u = '/storage/v1/object/public/content%5cx'", 's1-route'],
  ['r11', 'scripts/x.ts', "export const u = '/storage/v1/bucket/masters/empty'", 's1-route'],
  ['r12', 'scripts/x.ts', "export const u = '/storage/v1/bucket/masters'", 's1-route'],
  [
    'r13',
    'scripts/x.ts',
    "export const u = '/storage/v1/render/image/authenticated/masters/x'",
    's1-route',
  ],
  ['r14', 'scripts/x.ts', "export const u = '/storage/v1/s3'", 's1-route'],
  [
    'r15',
    '.github/workflows/x.yml',
    'jobs:\n  a:\n    steps:\n      - run: curl -X DELETE "$U/storage/v1/object/content"',
    's1-route',
  ],
  [
    'r16',
    'tools/x.ipynb',
    '{ "cells": [{ "source": ["requests.delete(base + \\"/storage/v1/object/content\\")"] }] }',
    's1-route',
  ],
  ['r17', 'scripts/x.ts', '// see /storage/v1/object/move\nexport {}', 's1-route'],
  [
    'r18 (MU13-140)',
    'tools/publisher/x.ts',
    "export const u = '/storage/v1/object/move'",
    's1-route',
  ],
  // Review fix SEC-2: forms a URL parser turns into a real route (catalogue path class 4).
  [
    'r19 a base with no trailing slash',
    'scripts/x.ts',
    "const base = (u: string) => `${u}/storage/v1`\nexport const del = (u: string, b: string) =>\n  fetch(`${base(u)}/object/${b}`, { method: 'DELETE' })",
    's1-route',
  ],
  [
    'r20 a workflow base with no trailing slash',
    '.github/workflows/x.yml',
    '      - run: curl -X DELETE "$SUPABASE_URL/storage/v1"/object/content',
    's1-route',
  ],
  [
    'r21 backslash separators',
    'scripts/x.ts',
    "export const u = '\\\\storage\\\\v1\\\\object\\\\authenticated\\\\masters\\\\x'",
    's1-route',
  ],
  [
    'r22 a dot-dot segment',
    'scripts/x.ts',
    "export const u = '/storage/x/../v1/object/sign/x'",
    's1-route',
  ],
  [
    'r23 a single-dot segment',
    'scripts/x.ts',
    "export const u = '/storage/./v1/object/move'",
    's1-route',
  ],
  ['r24 %2e%2e', 'scripts/x.ts', "export const u = '/storage/x/%2e%2e/v1/object/copy'", 's1-route'],
  ['r25 a tab inside', 'scripts/x.ts', "export const u = '/stor\\tage/v1/object/move'", 's1-route'],
  [
    'r26 a newline inside',
    'scripts/x.ts',
    "export const u = '/storage/v\\n1/object/move'",
    's1-route',
  ],
  [
    'r27 a percent-encoded letter',
    'scripts/x.ts',
    "export const u = '/%73torage/v1/object/move'",
    's1-route',
  ],
  [
    'r28 a later word on a line with an earlier ?',
    'scripts/x.sh',
    'curl -s $U/health?x=1 && curl -X DELETE $U/storage/./v1/object/content/x',
    's1-route',
  ],
  // Review fix SEC2-5: quotes and escapes the shell, PowerShell or cmd removes before the request.
  [
    't1 adjacent quoted strings',
    'scripts/x.sh',
    'curl -X DELETE "$U/stor""age/v1/object/masters"',
    's1-route',
  ],
  [
    't2 a quoted segment',
    'scripts/x.sh',
    `curl -X DELETE "$U"/'storage'/v1/object/masters`,
    's1-route',
  ],
  [
    't6 a quote before the slash',
    'scripts/x.sh',
    'curl -X DELETE "$U/storage"/v1/object/masters',
    's1-route',
  ],
  [
    't6b the same in a workflow',
    '.github/workflows/x.yml',
    '      - run: curl -X DELETE "$U/storage"/v1/object/masters',
    's1-route',
  ],
  [
    't7 a PowerShell backtick',
    'tools/x.ps1',
    'Invoke-RestMethod -Method Delete "$u/stor`age/v1/object/content"',
    's1-route',
  ],
  ['t8 a cmd caret', 'scripts/x.cmd', 'curl -X DELETE %U%/stor^age/v1/object/masters', 's1-route'],
  [
    't9 a package.json script',
    'package.json',
    '{ "scripts": { "x": "curl -X DELETE \\"$U/storage\\"/v1/object/masters" } }',
    's1-route',
  ],
  ['n1', 'scripts/x.ts', "export const u = '/storage/v1/object/public/content/x.json'", null],
  ['n2', 'scripts/x.ts', "export const u = 'storage/v10/'", null],
  ['n4', 'scripts/x.ts', "export const u = 'storage/v1beta'", null],
  [
    'n5 a public path after parsing',
    'scripts/x.ts',
    "export const u = '/storage/./v1/object/public/content/x.json'",
    null,
  ],
  [
    'n6 quotes in a file that does not run stay as written',
    'src/x.md',
    'Write "storage"/"v1" as two words',
    null,
  ],
  [
    'n7 a quoted public path in a script',
    'scripts/x.sh',
    'curl "$U/storage"/v1/object/public/content/x.json',
    null,
  ],
]

const SUPABASE_SAMPLES: readonly Sample[] = [
  ['b1', 'scripts/x.ts', "import { createClient } from '@supabase/supabase-js'", 's1-supabase'],
  ['b2', 'scripts/x.cjs', "const s = require('@supabase/supabase-js')", 's1-supabase'],
  ['b3', 'scripts/x.ts', "export const s = await import('@supabase/storage-js')", 's1-supabase'],
  ['b4', 'scripts/x.ts', "export * from '@supabase/supabase-js'", 's1-supabase'],
  [
    'b5',
    'scripts/x.ts',
    "import type { SupabaseClient } from '@supabase/supabase-js'",
    's1-supabase',
  ],
  ['b6', 'scripts/x.ts', "import x from '@SUPABASE/supabase-js'", 's1-supabase'],
  ['b7', 'scripts/x.ts', "import '@supabase/storage-js/dist/main'", 's1-supabase'],
  ['b8', 'scripts/x.ts', "import s = require('@supabase/supabase-js')", 's1-supabase'],
  [
    'b9',
    'scripts/x.ts',
    "export type C = import('@supabase/supabase-js').SupabaseClient",
    's1-supabase',
  ],
  ['n1', 'scripts/x.ts', "import y from '@supabasex/y'", null],
]

const CLI_SAMPLES: readonly Sample[] = [
  ['c1', '.github/workflows/x.yml', 'run: supabase storage rm ss:///masters/canary.txt', 's1-cli'],
  [
    'c2',
    'tools/sample/package.json',
    '{ "scripts": { "x": "npx supabase storage cp a ss:///content/x" } }',
    's1-cli',
  ],
  ['c3', 'scripts/x.sh', 'SUPABASE STORAGE LS', 's1-cli'],
  ['c4', '.github/workflows/x.yml', 'run: supabase --experimental storage mv a b', 's1-cli'],
  ['c5', '.github/workflows/x.yml', 'run: supabase --workdir ./w storage rm x', 's1-cli'],
  ['c6', 'src/x.md', 'Copy with ss:///masters', 's1-cli'],
  ['c7', 'scripts/x.ts', "export const c = 'npx supabase storage ls ss:///content'", 's1-cli'],
  ['c8 quote-split (SEC2-5)', '.github/workflows/x.yml', 'run: supa"base" storage rm x', 's1-cli'],
  ['n1', 'scripts/x.ts', '// Supabase Storage REST client for the publisher\nexport {}', null],
  [
    'n2',
    'src/x.ts',
    "/** The one origin that serves media and images: the project's Supabase Storage (owner decision D3, */\nexport {}",
    null,
  ],
]

const APIKEY_SAMPLES: readonly Sample[] = [
  ['d1', 'scripts/x.ts', 'export const h = (k: string) => ({ apikey: k })', 's1-apikey'],
  ['d2', 'scripts/x.ts', "export const h = (k: string) => ({ 'apikey': k })", 's1-apikey'],
  ['d3', 'scripts/x.ts', 'export const h = (k: string) => ({ ApiKey: k })', 's1-apikey'],
  ['d4', 'scripts/x.ts', "export const h = (k: string) => ({ ['apikey']: k })", 's1-apikey'],
  ['d5', 'scripts/x.ts', 'export const h = (k: string) => ({ [`apikey`]: k })', 's1-apikey'],
  [
    'd6',
    'scripts/x.ts',
    "export const f = (h: Headers, k: string) => h.set('APIKEY', k)",
    's1-apikey',
  ],
  [
    'd7',
    'scripts/x.ts',
    "export const f = (k: string) => new Headers([['apikey', k]])",
    's1-apikey',
  ],
  [
    'd8',
    'scripts/x.ts',
    "export const f = (h: Record<string, string>, k: string) => { h['apikey'] = k }",
    's1-apikey',
  ],
  ['d9', 'scripts/x.ts', "export const n = 'api\\u006bey'", 's1-apikey'],
  ['d10', '.github/workflows/other.yml', '      - run: curl -H "apikey: $K" "$U"', 's1-apikey'],
  ['d11', 'scripts/x.json', '{"apikey":"x"}', 's1-apikey'],
  ['d12', 'scripts/x.ts', 'export const f = (apiKey: string) => ({ apiKey })', 's1-apikey'],
  ['d13 (MR13-21)', '.github/workflows/keep-alive.yml', 'run: supabase storage rm x', 's1-cli'],
  // Review fix SEC-5: the header as a PowerShell hashtable key and as a Python keyword argument.
  ['d14', 'scripts/x.ps1', 'Invoke-RestMethod -Headers @{ apikey = $k } -Uri $u', 's1-apikey'],
  ['d15', 'scripts/x.py', 'requests.post(u, headers=dict(apikey=k))', 's1-apikey'],
  // Review fix SEC2-5: the header name split by quotes the shell removes.
  ['d16 quote-split', 'scripts/x.sh', 'curl -H "api"key: $K "$U"', 's1-apikey'],
  [
    'd17 quote-split in a workflow',
    '.github/workflows/other.yml',
    `      - run: curl -H 'api''key: '"$K" "$U"`,
    's1-apikey',
  ],
  [
    'd18 quote-split in a package.json script',
    'package.json',
    '{ "scripts": { "x": "curl -H \\"api\\"key: $K $U" } }',
    's1-apikey',
  ],
  ['d19 a JSON-escaped header line', 'scripts/x.json', '{ "h": "api\\u006bey: x" }', 's1-apikey'],
  ['n1', 'scripts/x.ts', 'export const apiKey = 1', null],
  ['n2', 'scripts/x.ts', 'export const f = (options: { apiKey: string }) => options.apiKey', null],
  ['n3', 'scripts/x.ts', "export const n = 'x-apikey'", null],
  ['n4', 'scripts/x.ts', "export const n = 'apikeys'", null],
  ['n5', 'scripts/x.ts', 'export const api_key = 1', null],
  ['n6', 'supabase/x.toml', '# user = "apikey"', null],
  ['n8', 'scripts/x.py', 'apikeys = 1\nx_apikey = 2\nx-apikey: 3', null],
  [
    'n7 (allowed form d)',
    '.github/workflows/keep-alive.yml',
    'run: curl -H "apikey: $K" "$U"',
    null,
  ],
]

const UPSERT_SAMPLES: readonly Sample[] = [
  ['e1', 'scripts/x.ts', "export const n = 'x-upsert'", 's1-upsert'],
  ['e2', 'scripts/x.ts', "export const n = 'X-Upsert'", 's1-upsert'],
  ['e3', 'scripts/x.json', '["x-upsert"]', 's1-upsert'],
  ['e4', 'scripts/x.ts', "export const n = 'x\\u002dupsert'", 's1-upsert'],
  [
    'e5 (MR13-21)',
    '.github/workflows/keep-alive.yml',
    'run: curl -H "x-upsert: true" "$U"',
    's1-upsert',
  ],
  ['e6', 'tools/publisher/hook.ts', "export const n = 'x-upsert'", 's1-upsert'],
  ['e7 quote-split (SEC2-5)', 'scripts/x.sh', 'curl -H "x-up"sert: true "$U"', 's1-upsert'],
  ['n1 (allowed)', 'tools/publisher/storage.ts', "export const n = 'x-upsert'", null],
  ['n2 (allowed)', 'tools/publisher/storage-stub.ts', "export const n = 'x-upsert'", null],
]

const S1_LIMIT_SAMPLES: readonly Sample[] = [
  ['l1', 'scripts/x.ts', "export const u = 'stor' + 'age/v1/object/move'", null],
  ['l2', 'scripts/x.ts', "export const u = ['storage', 'v1', 'object'].join('/')", null],
  [
    'l3',
    'scripts/x.ts',
    'export const u = String.fromCharCode(115, 116, 111, 114, 97, 103, 101)',
    null,
  ],
  ['l4', 'scripts/x.ts', "export const n = 'x-' + 'upsert'", null],
]

const NAME_SAMPLES: readonly Sample[] = [
  ['k1', 'scripts/x.ts', 'export const k = process.env.SUPABASE_SECRET_KEY', 's2-name'],
  ['k2', 'scripts/x.ts', "export const k = process.env['SUPABASE_SECRET_KEY']", 's2-name'],
  ['k3', 'scripts/x.ts', 'export const { SUPABASE_SECRET_KEY } = process.env', 's2-name'],
  [
    'k4',
    'scripts/x.ts',
    "export const k = Reflect.get(process.env, 'SUPABASE_SECRET_KEY')",
    's2-name',
  ],
  ['k5', 'scripts/x.ts', 'export const k = process.env.supabase_secret_key', 's2-name'],
  ['k6', 'scripts/x.ts', "export const k = 'Supabase_Secret_Key'", 's2-name'],
  ['k7', 'scripts/x.ts', "export const k = 'SUPABASE\\u005fSECRET_KEY'", 's2-name'],
  ['k8', 'scripts/x.json', '{ "k": "SUPABASE_SECRET_KEY" }', 's2-name'],
  [
    'k9',
    '.github/workflows/x.yml',
    '        env:\n          K: ${{ secrets.SUPABASE_SECRET_KEY }}',
    's2-name',
  ],
  ['k10', '.github/workflows/x.yml', '          K: ${{ secrets.supabase_secret_key }}', 's2-name'],
  ['k11', 'scripts/x.ts', '// reads SUPABASE_SECRET_KEY\nexport {}', 's2-name'],
  ['k13 quote-split (SEC2-5)', 'scripts/x.sh', 'printenv "SUPABASE"_SECRET_KEY', 's2-name'],
  [
    'k12 (MU13-141)',
    'tools/publisher/storage.ts',
    'export const k = process.env.SUPABASE_SECRET_KEY',
    's2-name',
  ],
]

const MARKER_SAMPLES: readonly Sample[] = [
  [
    'm1',
    'scripts/x.ts',
    "export const f = (v?: string) => v?.startsWith('sb_secret_')",
    's2-marker',
  ],
  [
    'm2',
    'scripts/x.ts',
    "export const v = Object.values(process.env).find((v) => v?.startsWith('sb_secret_'))",
    's2-marker',
  ],
  ['m3', 'scripts/x.ts', 'export const r = /^sb_secret_/', 's2-marker'],
  ['m4', 'scripts/x.ts', "export const m = 'SB_SECRET'", 's2-marker'],
  ['m5', 'scripts/x.ts', "export const m = 'sb\\x5fsecret'", 's2-marker'],
  ['m6', 'scripts/x.ts', 'export const r = /sb\\x5fsecret/', 's2-marker'],
  ['m7', 'scripts/x.json', '{ "p": "sb_secret_" }', 's2-marker'],
  ['m8 quote-split (SEC2-5)', 'scripts/x.sh', 'grep "sb_"secret x', 's2-marker'],
]

const ENV_FILE_SAMPLES: readonly Sample[] = [
  [
    'f1',
    'scripts/x.ts',
    "import { readFileSync } from 'node:fs'\nexport const t = readFileSync('.env.local')",
    's2-env-file',
  ],
  [
    'f2',
    'scripts/x.ts',
    "import { join } from 'node:path'\nexport const p = (root: string) => join(root, '.env.local')",
    's2-env-file',
  ],
  ['f3', 'scripts/x.ts', "export const p = './.env'", 's2-env-file'],
  [
    'f4',
    'scripts/x.ts',
    'export const p = (root: string) => `${root}/.env.production`',
    's2-env-file',
  ],
  ['f5', 'scripts/x.ts', "export const p = '.ENV.LOCAL'", 's2-env-file'],
  ['f6', 'scripts/x.ts', "export const p = 'storyboard/.env.local'", 's2-env-file'],
  ['f7', 'scripts/x.ts', 'export const f = (p: string) => process.loadEnvFile(p)', 's2-env-file'],
  ['f8', 'scripts/x.ts', "export const f = process['loadEnvFile']", 's2-env-file'],
  ['f9', 'scripts/x.ts', 'export const { loadEnvFile } = process', 's2-env-file'],
  ['f10', 'scripts/x.ts', "export const f = Reflect.get(process, 'loadEnvFile')", 's2-env-file'],
  ['f11', 'scripts/x.ts', 'export function loadEnvFile() {}', 's2-env-file'],
  [
    'f12',
    'tools/sample/package.json',
    '{ "scripts": { "x": "node --env-file=.env.local y.js" } }',
    's2-env-file',
  ],
  ['f13', 'scripts/x.sh', 'tsx --env-file .env.local x.ts', 's2-env-file'],
  ['f14', 'scripts/x.ts', "import 'dotenv/config'", 's2-env-file'],
  ['f15', 'scripts/x.cjs', "require('dotenv').config()", 's2-env-file'],
  ['f16', 'scripts/x.ts', "import x from '@dotenvx/dotenvx'\nexport default x", 's2-env-file'],
  ['f17', 'scripts/x.ts', "export const a = ['node', '--env-file=x']", 's2-env-file'],
  ['f18 quote-split (SEC2-5)', 'scripts/x.sh', 'node --env-"file"="$F" x.js', 's2-env-file'],
  ['n1', 'scripts/x.ts', 'export const x = process.env.X', null],
  ['n2', 'scripts/x.ts', 'export const x = import.meta.env', null],
  ['n3', 'scripts/x.ts', "export const p = '.envrc'", null],
  ['n4', 'scripts/x.ts', "export const p = 'environment'", null],
  ['n5', 'scripts/x.ts', "export const p = 'env.ts'", null],
  ['n6', 'scripts/x.ts', '// reads .env.local\nexport {}', null],
  ['n7', 'scripts/x.ts', 'export const q = (n: string) => `is ${n} set in a .env* file?`', null],
  [
    'n8',
    '.github/workflows/x.yml',
    "    if: github.event.client_payload.environment == 'production'",
    null,
  ],
  ['n9', 'scripts/.gitignore', '.env*\n.env.local', null],
]

const YAML_SAMPLES: readonly Sample[] = [
  ['y1', '.github/workflows/x.yml', '          ALL: ${{ toJSON(secrets) }}', 's2-yaml'],
  ['y2', '.github/workflows/x.yml', '          ALL: ${{ toJson( secrets ) }}', 's2-yaml'],
  [
    'y3',
    '.github/workflows/x.yml',
    "          K: ${{ secrets[format('{0}', inputs.k)] }}",
    's2-yaml',
  ],
  ['y4', '.github/workflows/x.yml', '    secrets: inherit', 's2-yaml'],
  ['y5', '.github/workflows/x.yaml', '          ALL: ${{ secrets }}', 's2-yaml'],
  // Review fix SEC-3: the whole object in any other wrapping.
  [
    'y6',
    '.github/workflows/x.yml',
    '      - run: echo "${{ toJSON(secrets.*) }}" | base64',
    's2-yaml',
  ],
  ['y7', '.github/workflows/x.yml', `      - run: echo "\${{ join(secrets.*, ',') }}"`, 's2-yaml'],
  ['y8', '.github/workflows/x.yml', '          ALL: ${{ (secrets) }}', 's2-yaml'],
  ['y9', '.github/workflows/x.yml', "          ALL: ${{ secrets || '' }}", 's2-yaml'],
  ['y10', '.github/workflows/x.yml', '      - run: echo "${{ toJSON(env) }}" | base64', 's2-yaml'],
  ['y11', '.github/workflows/x.yml', `      - run: echo "\${{ join(env.*, ',') }}"`, 's2-yaml'],
  ['y12 a quoted key (SEC2-5)', '.github/workflows/x.yml', '    "secrets": inherit', 's2-yaml'],
  ['yn1', '.github/workflows/x.yml', '          K: ${{ secrets.SOME_NAME }}', null],
  ['yn2', '.github/workflows/x.yml', "        if: ${{ env.FAIL_ON_PURPOSE == 'true' }}", null],
  [
    'yn3',
    '.github/workflows/x.yml',
    '          T: ${{ inputs.env }} ${{ inputs.target-env }}',
    null,
  ],
  ['yn4', '.github/workflows/x.yml', '          N: ${{ secrets_count }} ${{ envoy }}', null],
]

const S2_LIMIT_SAMPLES: readonly Sample[] = [
  ['l1', 'scripts/x.ts', "export const n = ['SUPABASE', 'SECRET', 'KEY'].join('_')", null],
  ['l2', 'scripts/x.ts', 'export const v = (name: string) => process.env[name]', null],
  ['l3', 'scripts/x.ts', 'export const all = { ...process.env }', null],
  ['l4', 'scripts/x.ts', 'export const all = Object.entries(process.env)', null],
]

const REVEAL_SAMPLES: readonly Sample[] = [
  ['s1', 'scripts/x.ts', 'export const f = (s: any) => s.reveal()', 's3-reveal'],
  ['s2', 'scripts/x.ts', 'export const f = (s: any) => s?.reveal()', 's3-reveal'],
  ['s3', 'scripts/x.ts', 'export const f = (s: any) => s.reveal.call(s)', 's3-reveal'],
  ['s4', 'scripts/x.ts', 'export const f = (s: any) => s.reveal.bind(s)()', 's3-reveal'],
  [
    's5',
    'scripts/x.ts',
    'export const f = (s: any, Secret: any) => Secret.prototype.reveal.apply(s)',
    's3-reveal',
  ],
  ['s6', 'scripts/x.ts', "export const f = (s: any) => s['reveal']()", 's3-reveal'],
  ['s7', 'scripts/x.ts', 'export const f = (s: any) => s[`reveal`]()', 's3-reveal'],
  ['s8', 'scripts/x.ts', "export const f = (s: any) => s?.['reveal']()", 's3-reveal'],
  [
    's9',
    'scripts/x.ts',
    'declare const Secret: any\nexport const { reveal } = Secret.prototype',
    's3-reveal',
  ],
  ['s10', 'scripts/x.ts', 'declare const s: any\nexport const { reveal: r } = s', 's3-reveal'],
  ['s11', 'scripts/x.ts', "declare const s: any\nexport const { ['reveal']: r } = s", 's3-reveal'],
  [
    's12',
    'scripts/x.ts',
    'declare const s: any\nlet r: unknown\n;({ reveal: r } = s)\nexport { r }',
    's3-reveal',
  ],
  ['s13', 'scripts/x.ts', "export const f = (s: any) => Reflect.get(s, 'reveal')", 's3-reveal'],
  [
    's14',
    'scripts/x.ts',
    'export const f = (s: any, Secret: any) => Reflect.apply(Secret.prototype.reveal, s, [])',
    's3-reveal',
  ],
  [
    's15',
    'scripts/x.ts',
    "export const f = (Secret: any) => Object.getOwnPropertyDescriptor(Secret.prototype, 'reveal')",
    's3-reveal',
  ],
  ['s16', 'scripts/x.ts', "export const f = (s: any) => s['rev\\u0065al']()", 's3-reveal'],
  [
    's17',
    'scripts/x.ts',
    'declare const Secret: any\nconst p = Secret.prototype\nexport const f = p.reveal',
    's3-reveal',
  ],
  [
    's18',
    'src/x.tsx',
    'export const A = ({ s }: { s: any }) => <div>{s.reveal()}</div>',
    's3-reveal',
  ],
  ['s19', 'scripts/x.mjs', 'export const f = (s) => s.reveal()', 's3-reveal'],
  ['s20', 'scripts/x.cjs', 'module.exports = (s) => s.reveal()', 's3-reveal'],
  [
    's21',
    'scripts/x.ts',
    'declare const s: any\nlet r: unknown\n;({ reveal: r } = s)\n;[{ reveal: r }] = [s]\nexport { r }',
    's3-reveal',
  ],
  [
    's22 (MU13-144)',
    'tools/publisher/env.ts',
    'export const f = (s: any) => s.reveal()',
    's3-reveal',
  ],
]

const REVEAL_NEAR_MISSES: readonly Sample[] = [
  ['n1', 'scripts/x.ts', 'export const revealDone = 1', null],
  ['n2', 'src/x.tsx', 'export const A = () => <div data-reveal="done" />', null],
  ['n3', 'scripts/x.ts', "export class A {\n  reveal(): string {\n    return ''\n  }\n}", null],
  ['n4', 'scripts/x.ts', '// the reveal runs\nexport {}', null],
  ['n5', 'scripts/x.ts', "export const w = 'reveal'", null],
  ['n6', 'scripts/x.ts', 'export const f = (x: any) => x.revealed', null],
  ['n7', 'scripts/x.ts', 'export const o = { reveal: true }', null],
  ['n8', 'scripts/x.ts', 'export const f = (s: any) => s.Reveal()', null],
]

const REVEAL_LIMITS: readonly Sample[] = [
  ['l1', 'scripts/x.ts', 'export const f = (s: any, name: string) => s[name]()', null],
  ['l2', 'scripts/x.ts', "export const f = () => eval('s.reveal()')", null],
  [
    'l3',
    'scripts/x.ts',
    'export const f = (Secret: any, i: number) =>\n  Object.values(Object.getOwnPropertyDescriptors(Secret.prototype))[i].value',
    null,
  ],
]

// Review fix SEC2-4: a fenced module named by its repository path where the reach walk cannot follow.
const FENCED_PATH_SAMPLES: readonly Sample[] = [
  [
    'w3 a spawn argument',
    'scripts/run.ts',
    "import { spawnSync } from 'node:child_process'\nexport const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/publisher/storage.ts'])",
    'fw-path',
  ],
  [
    'w4 node -e code',
    'scripts/run.ts',
    "import { spawnSync } from 'node:child_process'\nexport const r = spawnSync(process.execPath, ['-e', \"import('./tools/publisher/storage.ts').then((m) => m)\"])",
    'fw-path',
  ],
  [
    'w5 eval code',
    'scripts/run.ts',
    'export const s = eval("import(\'../tools/publisher/storage.ts\')")',
    'fw-path',
  ],
  [
    'w6 a Worker with eval',
    'scripts/run.ts',
    "import { Worker } from 'node:worker_threads'\nexport const w = new Worker(\"import('../tools/publisher/storage.ts')\", { eval: true })",
    'fw-path',
  ],
  [
    'w7 a workflow run line',
    '.github/workflows/x.yml',
    `      - run: node --import tsx -e "import('./tools/publisher/content-deleter.ts')"`,
    'fw-path',
  ],
  [
    'w8 a package.json script',
    'package.json',
    '{ "scripts": { "takedown": "tsx tools/publisher/content-deleter.ts" } }',
    'fw-path',
  ],
  ['w9 backslashes in a shell script', 'scripts/x.sh', 'tsx tools\\publisher\\env.ts', 'fw-path'],
  [
    'w10 the stub named inside tools/publisher (F3)',
    'tools/publisher/hook.ts',
    "export const p = 'tools/publisher/storage-stub.ts'",
    'fw-path',
  ],
  [
    'w11 a template part',
    'scripts/run.ts',
    'export const c = (x: string) => `node tools/publisher/env.ts ${x}`',
    'fw-path',
  ],
  ['w12 upper case', 'scripts/run.ts', "export const p = 'TOOLS/PUBLISHER/STORAGE.TS'", 'fw-path'],
  [
    'w13 a quote-split path in a shell script',
    'scripts/x.sh',
    'tsx "tools/publisher/"content-deleter.ts',
    'fw-path',
  ],
  ['n1 a comment', 'scripts/run.ts', '// spawns tools/publisher/storage.ts\nexport {}', null],
  [
    'n2 a module that is not fenced',
    'scripts/run.ts',
    "export const p = 'tools/publisher/storage-layout.ts'",
    null,
  ],
  [
    'n3 a package.json script for verify',
    'package.json',
    '{ "scripts": { "verify": "tsx tools/publisher/verify.ts" } }',
    null,
  ],
  [
    'n4 env.ts named inside tools/publisher (F2 allows it)',
    'tools/publisher/x.ts',
    "export const p = 'tools/publisher/env.ts'",
    null,
  ],
  [
    'n5 storage.ts named by the deleter (F1 allows it)',
    'tools/publisher/content-deleter.ts',
    "export const p = 'tools/publisher/storage.ts'",
    null,
  ],
  ['n6 a file that does not run', 'src/x.md', 'Run tools/publisher/storage.ts by hand', null],
  [
    'n7 a longer name',
    'scripts/run.ts',
    "export const p = ['tools/publisher/environment.ts', 'tools/publisher/storage2.ts']",
    null,
  ],
]

// Review fix SEC2-8: writes to the global fetch or its dispatcher (S3 form fetch; lint classes 1-8,
// 10 and 11 of the guard-bypass catalogue).
const FETCH_SAMPLES: readonly Sample[] = [
  ['w1 a bare global', 'scripts/x.ts', "fetch = async () => new Response('')", 's3-fetch'],
  [
    'w2 globalThis.fetch',
    'scripts/x.ts',
    'const real = globalThis.fetch\nglobalThis.fetch = async (u: any, i: any) => {\n  console.log(i)\n  return real(u, i)\n}',
    's3-fetch',
  ],
  ['w3 self.fetch', 'src/x.ts', 'declare const f: any\nself.fetch = f', 's3-fetch'],
  [
    'w4 a computed literal key',
    'scripts/x.ts',
    "declare const f: any\nglobalThis['fetch'] = f",
    's3-fetch',
  ],
  [
    'w5 a computed template key',
    'scripts/x.ts',
    'declare const f: any\nglobalThis[`fetch`] = f',
    's3-fetch',
  ],
  [
    'w6 an alias',
    'scripts/x.ts',
    'declare const f: any\nconst g: any = globalThis\ng.fetch = f',
    's3-fetch',
  ],
  [
    'w7 a destructuring assignment',
    'scripts/x.ts',
    'declare const f: any\n;({ f: globalThis.fetch } = { f })',
    's3-fetch',
  ],
  [
    'w8 an array destructuring assignment',
    'scripts/x.ts',
    'declare const f: any\n;[globalThis.fetch] = [f]',
    's3-fetch',
  ],
  [
    'w9 a compound assignment',
    'scripts/x.ts',
    'declare const f: any\nglobalThis.fetch ??= f',
    's3-fetch',
  ],
  [
    'w10 a shorthand destructuring assignment',
    'scripts/x.ts',
    'declare const mod: any\nlet fetch: unknown\n;({ fetch } = mod)\nexport { fetch }',
    's3-fetch',
  ],
  [
    'w11 Object.defineProperty',
    'scripts/x.ts',
    "declare const f: any\nObject.defineProperty(globalThis, 'fetch', { value: f })",
    's3-fetch',
  ],
  [
    'w12 Reflect.set',
    'scripts/x.ts',
    "declare const f: any\nReflect.set(globalThis, 'fetch', f)",
    's3-fetch',
  ],
  [
    'w13 Object.assign',
    'scripts/x.ts',
    'declare const f: any\nObject.assign(globalThis, { fetch: f })',
    's3-fetch',
  ],
  [
    'w14 Object.defineProperties',
    'scripts/x.ts',
    'declare const f: any\nObject.defineProperties(globalThis, { fetch: { value: f } })',
    's3-fetch',
  ],
  [
    'w15 a cooked escape',
    'scripts/x.ts',
    "declare const f: any\nglobalThis['fet\\u0063h'] = f",
    's3-fetch',
  ],
  [
    'w16 stubGlobal in a helper',
    'scripts/testing/x.ts',
    "declare const vi: any, f: any\nvi.stubGlobal('fetch', f)",
    's3-fetch',
  ],
  [
    'w17 undici setGlobalDispatcher',
    'scripts/x.ts',
    "import { setGlobalDispatcher, Agent } from 'undici'\nsetGlobalDispatcher(new Agent())",
    's3-fetch',
  ],
  [
    'w18 the dispatcher symbol',
    'scripts/x.ts',
    "declare const d: any\n;(globalThis as any)[Symbol.for('undici.globalDispatcher.1')] = d",
    's3-fetch',
  ],
  ['w19 a .mjs', 'scripts/x.mjs', 'globalThis.fetch = (u) => u', 's3-fetch'],
  ['w20 a .cjs', 'scripts/x.cjs', 'global.fetch = (u) => u', 's3-fetch'],
  [
    'w21 a computed Reflect method',
    'scripts/x.ts',
    "declare const f: any\nReflect['defineProperty'](globalThis, 'fetch', { value: f })",
    's3-fetch',
  ],
  [
    'w22 a for-of target',
    'scripts/x.ts',
    'declare const f: any\nfor (globalThis.fetch of [f]) {\n  break\n}',
    's3-fetch',
  ],
]

const FETCH_NEAR_MISSES: readonly Sample[] = [
  ['n1 a call', 'scripts/x.ts', "export const r = () => fetch('/x')", null],
  ['n2 a local declaration', 'scripts/x.ts', 'const fetch = () => 1\nexport { fetch }', null],
  [
    'n3 a property named fetch passed to a function',
    'scripts/x.ts',
    'declare const make: any, f: any\nexport const c = make({ fetch: f })',
    null,
  ],
  ['n4 fetchImpl', 'scripts/x.ts', 'declare const o: any, f: any\no.fetchImpl = f', null],
  ['n5 prefetch', 'src/x.ts', 'declare const link: any\nlink.prefetch = false', null],
  ['n6 a comment', 'scripts/x.ts', '// globalThis.fetch = f\nexport {}', null],
  ['n7 a read', 'scripts/x.ts', 'export const f = globalThis.fetch', null],
  ['n8 Object.hasOwn', 'scripts/x.ts', "export const h = Object.hasOwn(globalThis, 'fetch')", null],
  ['n9 a destructuring read', 'scripts/x.ts', 'export const { fetch: f } = globalThis', null],
  ['n10 the word in a string', 'scripts/x.ts', "export const n = 'fetch'", null],
]

const FETCH_LIMITS: readonly Sample[] = [
  [
    'l1 a name built at run time',
    'scripts/x.ts',
    "declare const f: any\n;(globalThis as any)['fet' + 'ch'] = f",
    null,
  ],
  [
    'l2 Object.assign from another object',
    'scripts/x.ts',
    'declare const wrappers: any\nObject.assign(globalThis, wrappers)',
    null,
  ],
  [
    'l3 a prototype patch',
    'scripts/x.ts',
    'Headers.prototype.set = function () {\n  return undefined\n}',
    null,
  ],
]

const ALL_SAMPLES: readonly (readonly Sample[])[] = [
  FENCED_PATH_SAMPLES,
  FETCH_SAMPLES,
  FETCH_NEAR_MISSES,
  FETCH_LIMITS,
  ROUTE_SAMPLES,
  SUPABASE_SAMPLES,
  CLI_SAMPLES,
  APIKEY_SAMPLES,
  UPSERT_SAMPLES,
  S1_LIMIT_SAMPLES,
  NAME_SAMPLES,
  MARKER_SAMPLES,
  ENV_FILE_SAMPLES,
  YAML_SAMPLES,
  S2_LIMIT_SAMPLES,
  REVEAL_SAMPLES,
  REVEAL_NEAR_MISSES,
  REVEAL_LIMITS,
]

/** Checks each sample alone: its form is among its findings, or (null) it gives no finding at all. */
function expectSamples(group: string, samples: readonly Sample[]): void {
  for (const [id, path, text, form] of samples) {
    const scan = scanFiles({ [path]: text })
    const forms = scan.findings.map((finding) => finding.slice(finding.lastIndexOf(' ') + 1))
    if (form === null) {
      expect.soft(scan.findings, `(${group}) ${id} ${path} is not flagged`).toEqual([])
    } else {
      expect.soft(forms, `(${group}) ${id} ${path} gives ${form}`).toContain(form)
    }
    expect.soft(scan.walk.findings, `(${group}) ${id} ${path} walks cleanly`).toEqual([])
  }
}

/** The reach findings of an in-memory tree, through the same walker. */
function reachOfFiles(files: Readonly<Record<string, string>>): string[] {
  const walk = walkTree(memoryReader(files, []))
  return reachFindings(walk, tokenCache(walk))
}

const loads = (findings: readonly string[], entry: string, fence: string) =>
  findings.some((finding) => finding.startsWith(`${entry}: loads the ${fence} module`))

/** A module's runtime export names, imported by a path built at run time. */
async function exportNames(file: string): Promise<string[]> {
  return Object.keys(await moduleOf(file)).sort()
}

/** A module, imported by a path built at run time (a missing file fails its own test only). */
async function moduleOf(file: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ pathToFileURL(join(HERE, file)).href)) as Record<
    string,
    unknown
  >
}

const STORAGE_FILES = {
  'tools/publisher/storage.ts': "import type { Secret } from './env'\nexport const x = 1",
  'tools/publisher/env.ts': 'export class Secret {}',
  'tools/publisher/storage-layout.ts': 'export const y = 1',
} as const

// ---- the real tree, walked once (13.1 I) ----

interface RealTree {
  readonly scan: Scan
  readonly reads: readonly string[]
  readonly reach: readonly string[]
  readonly entries: readonly string[]
  readonly elapsedMs: number
}

let real: RealTree

beforeAll(() => {
  const started = performance.now()
  const reads: string[] = []
  const walk = walkTree(recording(realReader(), reads))
  const scan = scanWalk(walk)
  const reach = reachFindings(walk, scan.tokens)
  real = { scan, reads, reach, entries: entriesOf(walk), elapsedMs: performance.now() - started }
}, WALK_TIMEOUT)

const realHits = (path: string, form: FormId) =>
  real.scan.hits
    .filter((hit) => hit.path === path && hit.form === form)
    .map((hit) => hit.line)
    .sort((a, b) => a - b)
const realRead = (path: string) => real.reads.includes(path)
const realTree = (path: string) => real.scan.walk.trees.get(path)

/** The cooked string literals and template parts of a parsed file that hold `storage/v1`. */
function routeLiterals(tree: ts.SourceFile): string[] {
  const found = new Set<string>()
  for (const { value } of tokensOf(tree).literals) {
    if (/storage\/v1/i.test(value)) found.add(value)
  }
  return [...found].sort()
}

// ---- Step 14's entries and pins (design p1-step14-design.md §3.15 D14-11, D14-20; T14-82 to T14-87) ----

/** The publisher CLI: the one F1 row and the one env-file reader Step 14 adds. */
const PUBLISHER_CLI = 'tools/publisher/cli.ts'

/**
 * FS2a g4 (§3.15 edit 3): the publisher CLI's two env-file lines, trimmed, copied from the formatted
 * file: the import, and the entry block's deps line that passes loadEnvFile by reference.
 */
const CLI_ENV_FILE_LINES: readonly string[] = [
  "import { loadEnvFile, readStorageCredentials } from './env'",
  'loadEnv: loadEnvFile,',
]

/** The trimmed text of each line of `path` that gives `form`, in line order. */
function lineTextsOf(scan: Scan, path: string, form: FormId): string[] {
  const lines = (scan.walk.files.find((file) => file.path === path)?.text ?? '').split('\n')
  return scan.hits
    .filter((hit) => hit.path === path && hit.form === form)
    .map((hit) => hit.line)
    .sort((a, b) => a - b)
    .map((line) => (lines[line - 1] ?? '').trim())
}

/** FS2a g4's compare: exactly the pinned lines, in order. */
const isPinnedEnvFileForm = (texts: readonly string[]): boolean =>
  texts.length === CLI_ENV_FILE_LINES.length &&
  texts.every((text, index) => text === CLI_ENV_FILE_LINES[index])

/**
 * FS4b g2 (§3.15 edit 9): the layout functions the stub must never call, so it answers from its own
 * rules and never asks the fence (S14-CRIT-6 adds contentReadTarget).
 */
const FENCE_ANSWERS: readonly string[] = [
  'targetOf',
  'pointerTarget',
  'classOfPath',
  'contentReadTarget',
]

/** FS4b g2's filter: each identifier that names a fence answer, as `name:line`. */
function asksTheFence(tokens: ScriptTokens): string[] {
  return tokens.identifiers
    .filter(({ value }) => FENCE_ANSWERS.includes(value))
    .map(({ value, line }) => `${value}:${line}`)
}

/** The eight Step 13 non-test scripts under tools/publisher/ (FS4d g0). */
const STEP13_PUBLISHER: ReadonlySet<string> = new Set([
  'tools/publisher/content-deleter.ts',
  'tools/publisher/env.ts',
  'tools/publisher/hook.ts',
  'tools/publisher/http.ts',
  'tools/publisher/storage-layout.ts',
  'tools/publisher/storage-stub.ts',
  'tools/publisher/storage.ts',
  'tools/publisher/verify.ts',
])

/** One FS4d row: exact specifiers, plus any src/core module, plus (stage-testkit only) any node: module. */
interface ImportRow {
  readonly specs: readonly string[]
  readonly srcCore: boolean
  readonly anyNode: boolean
}

const importRow = (specs: readonly string[], srcCore = true, anyNode = false): ImportRow => ({
  specs,
  srcCore,
  anyNode,
})

/** Each Step 14 module's allowed specifiers (§3.15 edit 8, D14-20). */
const FS4D_ROWS: ReadonlyMap<string, ImportRow> = new Map([
  ['tools/publisher/args.ts', importRow(['node:path'])],
  ['tools/publisher/port.ts', importRow(['./storage-layout'], false)],
  ['tools/publisher/local-files.ts', importRow(['node:fs', 'node:path'], false)],
  ['tools/publisher/media-check.ts', importRow([])],
  [
    'tools/publisher/story-checks.ts',
    importRow(['zod', './local-files', './media-check', './port', './storage-layout']),
  ],
  ['tools/publisher/catalogue-state.ts', importRow(['./port', './storage-layout'])],
  [
    'tools/publisher/stage.ts',
    importRow([
      './catalogue-state',
      './local-files',
      './media-check',
      './port',
      './report',
      './run-kit',
      './story-checks',
      './storage-layout',
      'node:path',
    ]),
  ],
  ['tools/publisher/report.ts', importRow(['node:fs', 'node:path'])],
  ['tools/publisher/stage-testkit.ts', importRow([], true, true)],
  // Step 15a's modules (p1-step15a-design.md D15-20).
  [
    'tools/publisher/approve.ts',
    importRow([
      './answers',
      './catalogue-state',
      './port',
      './remote-checks',
      './report',
      './run-kit',
      './storage-layout',
    ]),
  ],
  ['tools/publisher/answers.ts', importRow(['node:readline'])],
  [
    'tools/publisher/publish.ts',
    importRow([
      './catalogue-state',
      './port',
      './remote-checks',
      './report',
      './run-kit',
      './storage-layout',
      './takedown',
    ]),
  ],
  [
    'tools/publisher/remote-checks.ts',
    importRow(['./port', './run-kit', './story-checks', './storage-layout']),
  ],
  ['tools/publisher/run-kit.ts', importRow(['./report'], false)],
  // Step 15b's modules (p1-step15b-design.md D15B-25; takedown.ts holds no node:fs, D15B-36).
  [
    'tools/publisher/takedown.ts',
    importRow([
      './args',
      './catalogue-state',
      './local-files',
      './port',
      './remote-checks',
      './report',
      './run-kit',
      './storage-layout',
      'node:path',
    ]),
  ],
  [
    'tools/publisher/verify-command.ts',
    importRow([
      './catalogue-state',
      './port',
      './remote-checks',
      './report',
      './run-kit',
      './storage-layout',
    ]),
  ],
  [
    PUBLISHER_CLI,
    importRow(
      [
        './approve',
        './args',
        './content-deleter',
        './env',
        './hook',
        './port',
        './publish',
        './run-kit',
        './stage',
        './storage',
        './verify',
        './verify-command',
        '../../scripts/load-content',
        '../../src/config/security-headers',
        'node:fs',
        'node:path',
        'node:url',
      ],
      false,
    ),
  ],
])

/** g4: modules that open a network or run other code, with or without `node:`. */
const NETWORK_MODULES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'child_process',
  'worker_threads',
  'cluster',
  'vm',
])
/** g5: the network globals, as an identifier or an exact literal. */
const NETWORK_NAMES: ReadonlySet<string> = new Set([
  'fetch',
  'WebSocket',
  'EventSource',
  'XMLHttpRequest',
  'Request',
])
/** g3: the targets no new module imports, and those only the CLI imports. */
const NEVER_IMPORTED: readonly string[] = ['tools/publisher/storage-stub']
const CLI_ONLY_IMPORTS: readonly string[] = [
  'tools/publisher/storage',
  'tools/publisher/env',
  'tools/publisher/hook',
  'tools/publisher/verify',
  'tools/publisher/content-deleter',
]
/** g3: the env.ts exports the CLI names, and no other (S14-AUD-13). */
const CLI_ENV_NAMES: readonly string[] = [
  'loadEnvFile',
  'readDeployHookUrl',
  'readSiteUrl',
  'readStorageCredentials',
]
/** g8 (S14-AUD-14): the CLI's two captureRunContext lines, trimmed, copied from the formatted file. */
const CLI_RUN_CONTEXT_LINES: readonly string[] = [
  "import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'",
  'const runContext = captureRunContext(process.env, process.platform)',
]

const isRelativeSpecifier = (spec: string): boolean => {
  const text = spec.replaceAll('\\', '/')
  return text === '.' || text === '..' || text.startsWith('./') || text.startsWith('../')
}

/**
 * A relative specifier's target from `from`, lower-cased, without a script extension or `/index`:
 * './Hook.js' from tools/publisher/stage.ts is 'tools/publisher/hook'. null for any other specifier.
 */
function relativeTarget(from: string, spec: string): string | null {
  if (!isRelativeSpecifier(spec)) return null
  return posix
    .normalize(posix.join(posix.dirname(from), spec.replaceAll('\\', '/')))
    .replace(/\/$/, '')
    .replace(/\.[cm]?[jt]sx?$/i, '')
    .replace(/\/index$/i, '')
    .toLowerCase()
}

/** g1: an exact specifier of the row, a module under src/core (after `..` is resolved), or a node: module. */
function inImportRow(row: ImportRow, from: string, spec: string): boolean {
  if (row.specs.includes(spec)) return true
  if (
    row.srcCore &&
    spec.startsWith('../../src/core/') &&
    posix.normalize(posix.join(posix.dirname(from), spec)).startsWith('src/core/')
  ) {
    return true
  }
  return row.anyNode && spec.startsWith('node:')
}

const FS4D_GROUPS = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'] as const
type Fs4dGroup = (typeof FS4D_GROUPS)[number]
type Fs4dFindings = Record<Fs4dGroup, string[]>

/**
 * FS4d (§3.15 edit 8; D14-20): Step 14's pins over the shared tokens of one scan, not a new scanner
 * form. Every non-test script under tools/publisher/ that is not a Step 13 file is a new module: g0
 * needs its row, g1 keeps its specifiers within the row, g2-g7 apply to every new module, and g3's
 * name half and g8 read the CLI. A finding names the path, the line and the specifier or name.
 */
function fs4dFindings(scan: Scan, envExports: readonly string[]): Fs4dFindings {
  const found: Fs4dFindings = {
    g0: [],
    g1: [],
    g2: [],
    g3: [],
    g4: [],
    g5: [],
    g6: [],
    g7: [],
    g8: [],
  }
  const modules = scan.walk.files.filter(
    (file) =>
      file.cls === 'script' &&
      file.path.startsWith('tools/publisher/') &&
      !STEP13_PUBLISHER.has(file.path),
  )
  for (const file of modules) {
    const path = file.path
    const row = FS4D_ROWS.get(path)
    if (row === undefined) found.g0.push(path)
    const tokens = scan.tokens(path)
    if (tokens === null) continue
    for (const { value: spec, line } of tokens.specifiers) {
      const at = `${path}:${line} ${spec}`
      if (row !== undefined && !inImportRow(row, path, spec)) found.g1.push(at)
      const bare = !isRelativeSpecifier(spec) && !spec.startsWith('node:')
      if (bare && (spec !== 'zod' || path !== 'tools/publisher/story-checks.ts')) found.g2.push(at)
      const target = relativeTarget(path, spec)
      if (
        target !== null &&
        (NEVER_IMPORTED.includes(target) ||
          (CLI_ONLY_IMPORTS.includes(target) && path !== PUBLISHER_CLI))
      ) {
        found.g3.push(at)
      }
      const moduleName =
        spec
          .replaceAll('\\', '/')
          .replace(/^node:/i, '')
          .split('/')[0] ?? ''
      if (NETWORK_MODULES.has(moduleName.toLowerCase())) found.g4.push(at)
    }
    for (const { value, line } of [...tokens.identifiers, ...tokens.exactLiterals]) {
      if (NETWORK_NAMES.has(value)) found.g5.push(`${path}:${line} ${value}`)
    }
    for (const { value, line } of [...tokens.identifiers, ...tokens.exactLiterals]) {
      if (path !== PUBLISHER_CLI && (value === 'console' || value === 'process')) {
        found.g6.push(`${path}:${line} ${value}`)
      }
    }
    for (const { value, line } of tokens.literals) {
      if (/^panchatantra@/i.test(value)) found.g7.push(`${path}:${line}`)
    }
    if (path !== PUBLISHER_CLI) continue
    const named = [
      ...new Set(
        [...tokens.identifiers, ...tokens.exactLiterals]
          .map(({ value }) => value)
          .filter((value) => envExports.includes(value)),
      ),
    ].sort()
    if (named.join(' ') !== CLI_ENV_NAMES.join(' ')) {
      found.g3.push(`${path} env.ts names: ${named.join(' ')}`)
    }
    const lines = (file.text ?? '').split('\n')
    const captureLines = [
      ...new Set(
        tokens.identifiers
          .filter(({ value }) => value === 'captureRunContext')
          .map(({ line }) => line),
      ),
    ].sort((a, b) => a - b)
    const texts = captureLines.map((line) => (lines[line - 1] ?? '').trim())
    if (
      texts.length !== CLI_RUN_CONTEXT_LINES.length ||
      texts.some((text, index) => text !== CLI_RUN_CONTEXT_LINES[index])
    ) {
      found.g8.push(`${path}:${captureLines.join(',')} captureRunContext`)
    }
  }
  return found
}

// ---- export lists (FX; A18) ----

describe('export lists (FX)', () => {
  it('T13-FX1 storage.ts exports exactly the reviewed names, and none of the removed ones', async () => {
    const names = await exportNames('storage.ts')
    expect
      .soft(names, '(g1) the pinned list')
      .toEqual([
        'DEFAULT_TIMEOUT_MS',
        'LIST_PAGE_SIZE',
        'MAX_LIST_DEPTH',
        'MAX_LIST_ENTRIES',
        'StorageRefusedError',
        'classifyFailure',
        'classifyRead',
        'classifyUpload',
        'createStorageClient',
        'effectiveStatus',
        'isFolderPrefix',
        'repeatsSecretRun',
        'storageErrorCode',
      ])
    for (const removed of [
      'upload',
      'remove',
      'checkRemoved',
      'MAX_REMOVE_PATHS',
      'PROTECTED_BUCKETS',
      'isUnderPrefix',
      'send',
    ]) {
      expect.soft(names.includes(removed), `(g2) ${removed} is not exported`).toBe(false)
    }
  })

  it('T13-FX2 storage-layout.ts exports exactly the reviewed names, each a function or a number', async () => {
    const layout = await moduleOf('storage-layout.ts')
    expect
      .soft(Object.keys(layout).sort(), '(g1) the pinned list')
      .toEqual([
        'MASTERS_CACHE_SECONDS',
        'MAX_JSON_BYTES',
        'classOfPath',
        'contentReadTarget',
        'pointerTarget',
        'recheckTarget',
        'recheckUrl',
        'targetOf',
      ])
    for (const [name, value] of Object.entries(layout)) {
      expect
        .soft(
          ['function', 'number'].includes(typeof value),
          `(g2) ${name} is a function or a number`,
        )
        .toBe(true)
    }
  })

  it('T13-FX3 hook.ts exports exactly the reviewed names (an allowed reveal file cannot re-export a revealed value)', async () => {
    expect(await exportNames('hook.ts')).toEqual([
      'HOOK_TIMEOUT_MS',
      'hookRequestUrl',
      'parseHookJob',
      'triggerDeployHook',
    ])
  })

  it('T13-FX4 content-deleter.ts exports exactly the moved names', async () => {
    expect(await exportNames('content-deleter.ts')).toEqual([
      'MAX_REMOVE_PATHS',
      'PROTECTED_BUCKETS',
      'checkRemoved',
      'createContentDeleter',
      'isUnderPrefix',
    ])
  })

  it('T13-FX5 env.ts exports exactly the reviewed names', async () => {
    expect(await exportNames('env.ts')).toEqual([
      'ENV_FILE',
      'PUBLISHER_ENV_NAMES',
      'Secret',
      'checkPublisherEnv',
      'isSecretKeyShape',
      'loadEnvFile',
      'readDeployHookUrl',
      'readSecretKey',
      'readSiteUrl',
      'readStorageCredentials',
      'readSupabaseUrl',
    ])
  })

  it('T14-82 FX6 cli.ts exports exactly runCli (an allowed F1 file cannot re-export the client factory)', async () => {
    const cli = await moduleOf('cli.ts')
    expect(typeof cli.runCli, 'precondition: cli.ts loads and holds runCli').toBe('function')
    expect.soft(Object.keys(cli).sort(), '(g1) the pinned list').toEqual(['runCli'])
  })
})

// ---- the reach walk (FW; A16) ----

describe('the reach walk (FW)', () => {
  it(
    'T13-FW1 real tree: no entry reaches a fenced module it may not, and every specifier is followed',
    { timeout: WALK_TIMEOUT },
    () => {
      const files = real.scan.walk.files
      const scripts = files.filter((file) => file.cls === 'script').length
      console.log(
        `fence walk: ${real.entries.length} entries, ${real.scan.walk.trees.size} scripts parsed, ` +
          `${files.length} files listed, ${real.reach.length} reach findings; ` +
          `${Math.round(real.elapsedMs)} ms (budget 15000 ms, stop S7 at 30000 ms)`,
      )
      expect(real.entries.length, 'precondition: at least 180 entries').toBeGreaterThanOrEqual(180)
      expect(scripts, 'precondition: entries are the listed scripts').toBe(real.entries.length)
      for (const folder of ['app', 'e2e', 'scripts', 'src', 'tools']) {
        expect(
          real.entries.some((entry) => entry.startsWith(`${folder}/`)),
          `precondition: an entry under ${folder}/`,
        ).toBe(true)
      }
      for (const entry of [
        'tools/publisher/verify.ts',
        'tools/narration/cli.ts',
        'scripts/load-content.ts',
        'tools/publisher/storage-stub.ts',
        PUBLISHER_CLI,
      ]) {
        expect(real.entries, `precondition: ${entry} is an entry`).toContain(entry)
      }
      for (const fenced of [
        'tools/publisher/storage.ts',
        'tools/publisher/env.ts',
        'tools/publisher/content-deleter.ts',
      ]) {
        expect(
          files.some((file) => file.path === fenced),
          `precondition: ${fenced} is in the file set`,
        ).toBe(true)
      }
      expect.soft(real.reach, '(g1) no reach finding').toEqual([])
      expect
        .soft(real.elapsedMs, '(g2) the fence walk takes under 30 s (stop S7)')
        .toBeLessThan(30_000)
      expect
        .soft(
          real.scan.findings.filter((finding) => finding.endsWith(' fw-path')),
          '(g3) no fenced module named by its repository path outside its fence',
        )
        .toEqual([])
      const siteUrl = readFileSync(join(ROOT, 'src', 'config', 'site-url.ts'), 'utf8')
      expect(
        (siteUrl.split('\n')[10] ?? '').includes('tools/publisher/env.ts'),
        'precondition: site-url.ts:11 names env.ts in a comment',
      ).toBe(true)
      expect(realRead('src/config/site-url.ts'), 'precondition: site-url.ts was read').toBe(true)
      expect
        .soft(realHits('src/config/site-url.ts', 'fw-path'), '(g3) and site-url.ts is clean')
        .toEqual([])
    },
  )

  it('T13-FW2 F1: every import form reaches storage.ts from outside its allow-list', () => {
    const samples: readonly (readonly [string, Record<string, string>, string])[] = [
      [
        'a1 direct from scripts/',
        { 'scripts/x.ts': "import { x } from '../tools/publisher/storage'" },
        'scripts/x.ts',
      ],
      [
        'a2 export * wrapper in tools/publisher',
        { 'tools/publisher/wrap.ts': "export * from './storage'" },
        'tools/publisher/wrap.ts',
      ],
      [
        'a3 two hops through tools/narration',
        {
          'scripts/x.ts': "import { y } from '../tools/narration/hop'",
          'tools/narration/hop.ts': "export { x as y } from '../publisher/storage'",
        },
        'scripts/x.ts',
      ],
      [
        'a3b the hop itself',
        { 'tools/narration/hop.ts': "export { x as y } from '../publisher/storage'" },
        'tools/narration/hop.ts',
      ],
      [
        'a4 a wrapper outside tools/',
        {
          'src/wrap.ts': "export { x } from '../tools/publisher/storage'",
          'scripts/x.ts': "import { x } from '../src/wrap'",
        },
        'scripts/x.ts',
      ],
      [
        'a5 require in a .cjs',
        { 'scripts/x.cjs': "const s = require('../tools/publisher/storage')" },
        'scripts/x.cjs',
      ],
      [
        'a6 import()',
        { 'scripts/x.ts': "export const s = await import('../tools/publisher/storage')" },
        'scripts/x.ts',
      ],
      [
        'a7 import type',
        { 'scripts/x.ts': "import type { X } from '../tools/publisher/storage'" },
        'scripts/x.ts',
      ],
      [
        'a8 export type from',
        { 'scripts/x.ts': "export type { X } from '../tools/publisher/storage'" },
        'scripts/x.ts',
      ],
      [
        'a9 import-equals',
        { 'scripts/x.ts': "import s = require('../tools/publisher/storage')" },
        'scripts/x.ts',
      ],
      [
        'a10 an import type node',
        { 'scripts/x.ts': "export type C = import('../tools/publisher/storage').X" },
        'scripts/x.ts',
      ],
      [
        'a11 the @/ alias',
        { 'scripts/x.ts': "import { x } from '@/../tools/publisher/storage'" },
        'scripts/x.ts',
      ],
      [
        'a12 ./storage.js',
        { 'tools/narration/x.ts': "import { x } from '../publisher/storage.js'" },
        'tools/narration/x.ts',
      ],
      [
        'a13 upper case',
        { 'scripts/x.ts': "import { x } from '../tools/publisher/STORAGE'" },
        'scripts/x.ts',
      ],
      [
        'a14 a backslash specifier',
        { 'scripts/x.ts': "import { x } from '..\\\\tools\\\\publisher\\\\storage'" },
        'scripts/x.ts',
      ],
      [
        'a15 an index.ts folder import',
        {
          'tools/publisher/wrapdir/index.ts': "export * from '../storage'",
          'scripts/x.ts': "import { x } from '../tools/publisher/wrapdir'",
        },
        'scripts/x.ts',
      ],
      [
        'a16 a .mts entry',
        { 'scripts/x.mts': "import { x } from '../tools/publisher/storage'" },
        'scripts/x.mts',
      ],
      [
        'a17 a .cts entry',
        { 'scripts/x.cts': "import { x } from '../tools/publisher/storage'" },
        'scripts/x.cts',
      ],
      [
        'a18 a .jsx entry',
        {
          'src/x.jsx':
            "import { x } from '../tools/publisher/storage'\nexport const A = () => <i>{x}</i>",
        },
        'src/x.jsx',
      ],
      [
        'a19 a .mjs entry',
        { 'scripts/x.mjs': "import { x } from '../tools/publisher/storage.js'" },
        'scripts/x.mjs',
      ],
      // Review fix SEC-1: loads that take a path literal outside the specifier forms.
      [
        'a20 createRequire, bound',
        {
          'scripts/x.ts':
            "import { createRequire } from 'node:module'\nconst load = createRequire(import.meta.url)\nexport const s = load('../tools/publisher/storage')",
        },
        'scripts/x.ts',
      ],
      [
        'a21 createRequire, inline',
        {
          'scripts/x.ts':
            "import { createRequire } from 'node:module'\nexport const s = createRequire(import.meta.url)('../tools/publisher/storage')",
        },
        'scripts/x.ts',
      ],
      [
        'a22 module.require',
        { 'scripts/x.cjs': "module.exports = module.require('../tools/publisher/storage')" },
        'scripts/x.cjs',
      ],
      [
        'a23 require.call',
        { 'scripts/x.cjs': "module.exports = require.call(null, '../tools/publisher/storage')" },
        'scripts/x.cjs',
      ],
      [
        'a24 (require)(…)',
        { 'scripts/x.cjs': "module.exports = (require)('../tools/publisher/storage')" },
        'scripts/x.cjs',
      ],
      [
        'a25 globalThis.require',
        { 'scripts/x.ts': "export const s = globalThis.require('../tools/publisher/storage')" },
        'scripts/x.ts',
      ],
      [
        'a26 import.meta.resolve, then import(u)',
        {
          'scripts/x.ts':
            "const u = import.meta.resolve('../tools/publisher/storage')\nexport const s = await import(u)",
        },
        'scripts/x.ts',
      ],
      [
        'a27 a Worker URL',
        {
          'scripts/x.ts':
            "export const w = new Worker(new URL('../tools/publisher/storage.ts', import.meta.url))",
        },
        'scripts/x.ts',
      ],
      [
        'a28 a specifier held in a const, import(p)',
        {
          'scripts/x.ts':
            "const p = '../tools/publisher/storage'\nexport const s = await import(p)",
        },
        'scripts/x.ts',
      ],
      [
        'a29 a specifier held in a const, require(p)',
        { 'scripts/x.cjs': "const p = '../tools/publisher/storage'\nmodule.exports = require(p)" },
        'scripts/x.cjs',
      ],
      [
        'a30 an alias path in a const',
        {
          'scripts/x.ts':
            "const p = '@/../tools/publisher/storage'\nexport const s = await import(p)",
        },
        'scripts/x.ts',
      ],
      [
        'a31 a backslash path in a const',
        {
          'scripts/x.ts':
            "const p = '..\\\\tools\\\\publisher\\\\storage'\nexport const s = await import(p)",
        },
        'scripts/x.ts',
      ],
      // Review fix SEC2-4: loads that resolve a path against the working directory (storyboard/).
      [
        'a32 a Worker path from the working directory',
        {
          'scripts/run.ts':
            "import { Worker } from 'node:worker_threads'\nexport const w = new Worker('./tools/publisher/storage.ts')",
        },
        'scripts/run.ts',
      ],
      [
        'a33 fork from the working directory',
        {
          'scripts/run.ts':
            "import { fork } from 'node:child_process'\nexport const c = fork('./tools/publisher/storage.ts')",
        },
        'scripts/run.ts',
      ],
    ]
    for (const [id, files, entry] of samples) {
      const findings = reachOfFiles({ ...STORAGE_FILES, ...files })
      expect
        .soft(loads(findings, entry, 'F1 storage client'), `(g1) ${id}: ${entry} is a finding`)
        .toBe(true)
      expect
        .soft(
          findings.filter((finding) => finding.includes('cannot follow')),
          `(g1) ${id}: every specifier followed`,
        )
        .toEqual([])
    }
    const chain = reachOfFiles({ ...STORAGE_FILES, ...samples[2]?.[1] })
    expect
      .soft(
        chain.some((finding) =>
          finding.endsWith('(scripts/x.ts > tools/narration/hop.ts > tools/publisher/storage.ts)'),
        ),
        '(g2) a3 names the whole chain',
      )
      .toBe(true)
    expect
      .soft(reachOfFiles({ ...STORAGE_FILES }), '(g3) storage.ts as its own entry is not a finding')
      .toEqual([])
    expect
      .soft(
        reachOfFiles({
          ...STORAGE_FILES,
          'scripts/x.ts': "import { y } from '../tools/publisher/storage-layout'",
        }),
        '(g3) storage-layout.ts imported from scripts/ is not a finding',
      )
      .toEqual([])
    expect
      .soft(
        reachOfFiles({
          ...STORAGE_FILES,
          'scripts/x.ts':
            "export const paths = ['./missing-file', '../public/none.png', '@/nowhere']",
        }),
        '(g3) a path literal that names no repository file is not a finding or a problem',
      )
      .toEqual([])
    expect
      .soft(
        reachOfFiles({
          ...STORAGE_FILES,
          'scripts/x.ts': "export const s = await import('../tools/publisher/' + 'storage')",
        }),
        '(g4) documented limit: a specifier assembled at run time is not followed (catalogue class 13)',
      )
      .toEqual([])
  })

  it('T13-FW3 F2: env.ts is reached only from entries under tools/publisher/', () => {
    const findings = reachOfFiles({
      ...STORAGE_FILES,
      'scripts/a.ts': "import { Secret } from '../tools/publisher/env'",
      'tools/narration/b.ts': "import { Secret } from '../publisher/env'",
      'tools/publisher/hook.ts': "import type { Secret } from './env'\nexport const h = 1",
      'scripts/c.ts': "import type { h } from '../tools/publisher/hook'",
      'tools/publisher/verify.ts': "import { Secret } from './env'",
      'tools/publisher/sub/x.ts': "import { Secret } from '../env'",
    })
    expect
      .soft(loads(findings, 'scripts/a.ts', 'F2 env'), '(g1) scripts/ to env is a finding')
      .toBe(true)
    expect
      .soft(
        loads(findings, 'tools/narration/b.ts', 'F2 env'),
        '(g1) tools/narration to env is a finding',
      )
      .toBe(true)
    expect
      .soft(
        loads(findings, 'scripts/c.ts', 'F2 env'),
        '(g1) a type-only chain through hook.ts is a finding',
      )
      .toBe(true)
    expect
      .soft(loads(findings, 'tools/publisher/verify.ts', 'F2 env'), '(g2) verify.ts to env is not')
      .toBe(false)
    expect
      .soft(
        loads(findings, 'tools/publisher/sub/x.ts', 'F2 env'),
        '(g2) tools/publisher/sub to env is not',
      )
      .toBe(false)
    expect
      .soft(
        loads(findings, 'tools/publisher/storage.ts', 'F2 env'),
        '(g2) storage.ts to env is not',
      )
      .toBe(false)
  })

  it('T13-FW4 F3: the storage stub is reached by no entry', () => {
    const findings = reachOfFiles({
      'tools/publisher/storage-stub.ts':
        "import { createServer } from 'node:http'\nexport const s = createServer",
      'scripts/x.ts': "import { s } from '../tools/publisher/storage-stub'",
      'tools/publisher/hook.ts': "import { s } from './storage-stub'",
    })
    expect
      .soft(
        loads(findings, 'scripts/x.ts', 'F3 storage stub'),
        '(g1) scripts/ to the stub is a finding',
      )
      .toBe(true)
    expect
      .soft(
        loads(findings, 'tools/publisher/hook.ts', 'F3 storage stub'),
        '(g1) hook.ts to the stub is a finding',
      )
      .toBe(true)
    expect
      .soft(
        loads(findings, 'tools/publisher/storage-stub.ts', 'F3 storage stub'),
        '(g2) the stub as its own entry is not',
      )
      .toBe(false)
  })

  it('T13-FW5 fail closed: absolute, drive, URL, outside-repository and unresolved specifiers are problems naming the entry', () => {
    // Review fix SEC-1: a path literal that resolves is an edge whatever form loads it, so each
    // specifier form also proves itself here, where only the specifier reader can make a problem of
    // an unresolved name (a path literal that does not resolve is ignored).
    const files: Record<string, string> = {
      'scripts/a.ts': "import x from '/abs/x'",
      'scripts/b.ts': "import x from 'C:/x'",
      'scripts/c.ts': "import x from 'file:///x'",
      'scripts/d.ts': "import x from '../../../../outside'",
      'scripts/e.ts': "import x from './missing'",
      'scripts/f.cjs': "module.exports = require('./missing')",
      'scripts/g.ts': "export const s = await import('./missing')",
      'scripts/h.ts': "import type { X } from './missing'\nexport type Y = X",
      'scripts/i.ts': "export * from './missing'",
      'scripts/j.ts': "export type C = import('./missing').X",
      'scripts/k.ts': "import s = require('./missing')\nexport { s }",
    }
    const findings = reachOfFiles(files)
    for (const entry of Object.keys(files)) {
      expect
        .soft(
          findings.some((finding) => finding.startsWith(`${entry}: `)),
          `(g1) ${entry} is a problem`,
        )
        .toBe(true)
    }
    expect
      .soft(findings.length, '(g1) exactly one problem per entry')
      .toBe(Object.keys(files).length)
  })

  it('T13-FW6 F4: content-deleter.ts is reached by no entry but itself and cli.ts', () => {
    const findings = reachOfFiles({
      ...STORAGE_FILES,
      'tools/publisher/content-deleter.ts': "import { x } from './storage'",
      'scripts/x.ts': "import { d } from '../tools/publisher/content-deleter'",
      'scripts/x.test.mjs': "import { d } from '../tools/publisher/content-deleter.ts'",
    })
    expect
      .soft(
        loads(findings, 'scripts/x.ts', 'F4 content deleter'),
        '(g1) scripts/ to the deleter is a finding',
      )
      .toBe(true)
    expect
      .soft(
        loads(findings, 'scripts/x.test.mjs', 'F4 content deleter'),
        '(g3) a test-named script no runner runs (scripts/x.test.mjs) is an entry, and a finding',
      )
      .toBe(true)
    expect
      .soft(
        loads(findings, 'tools/publisher/content-deleter.ts', 'F4 content deleter') ||
          loads(findings, 'tools/publisher/content-deleter.ts', 'F1 storage client'),
        '(g2) the deleter as its own entry, reaching storage.ts, is not (F1 allow-list)',
      )
      .toBe(false)
    // Step 15b (p1-step15b-design.md D15B-14, D15B-25): F4's reviewed row. cli.ts is the deleter's
    // first and only caller; every other entry reaching it, by any number of hops, is a finding.
    const deleterFiles = {
      ...STORAGE_FILES,
      'tools/publisher/content-deleter.ts': "import { x } from './storage'\nexport const d = x",
    } as const
    const callsDeleter = "import { d } from './content-deleter'\nexport const c = d"
    expect
      .soft(
        reachOfFiles({ ...deleterFiles, [PUBLISHER_CLI]: callsDeleter }),
        '(g4) cli.ts reaching the deleter is no finding',
      )
      .toEqual([])
    const samples: readonly (readonly [string, Record<string, string>, string])[] = [
      [
        'publish.ts importing the deleter',
        { 'tools/publisher/publish.ts': callsDeleter },
        'tools/publisher/publish.ts',
      ],
      [
        'takedown.ts importing the deleter',
        { 'tools/publisher/takedown.ts': callsDeleter },
        'tools/publisher/takedown.ts',
      ],
      [
        'verify-command.ts importing the deleter',
        { 'tools/publisher/verify-command.ts': callsDeleter },
        'tools/publisher/verify-command.ts',
      ],
      [
        'a src/core wrapper of the deleter imported by publish.ts',
        {
          'src/core/net3.ts': "export * from '../../tools/publisher/content-deleter'",
          'tools/publisher/publish.ts':
            "import * as n from '../../src/core/net3'\nexport const y = n",
        },
        'tools/publisher/publish.ts',
      ],
      [
        "export * from './content-deleter' in port.ts",
        { 'tools/publisher/port.ts': "export * from './content-deleter'" },
        'tools/publisher/port.ts',
      ],
      [
        'two hops, report.ts > helper.ts > content-deleter.ts',
        {
          'tools/publisher/report.ts': "import { h } from './helper'\nexport const r = h",
          'tools/publisher/helper.ts': "import * as m from './content-deleter'\nexport const h = m",
        },
        'tools/publisher/report.ts',
      ],
      [
        'a type-only import of the deleter in stage.ts',
        {
          'tools/publisher/stage.ts':
            "import type { ContentDeleter } from './content-deleter'\nexport type D = ContentDeleter",
        },
        'tools/publisher/stage.ts',
      ],
      [
        'tools/publisher/Cli.ts importing the deleter',
        { 'tools/publisher/Cli.ts': callsDeleter },
        'tools/publisher/Cli.ts',
      ],
      [
        'tools/publisher/cli.mts importing the deleter',
        { 'tools/publisher/cli.mts': callsDeleter },
        'tools/publisher/cli.mts',
      ],
    ]
    for (const [id, files, entry] of samples) {
      expect
        .soft(
          loads(reachOfFiles({ ...deleterFiles, ...files }), entry, 'F4 content deleter'),
          `(g5) ${id} is a finding`,
        )
        .toBe(true)
    }
  })

  it('T13-FW7 a fenced module named by its repository path in a script literal or runnable text is a finding outside its fence', () => {
    expectSamples('g1', FENCED_PATH_SAMPLES)
  })

  it("T14-87 FW F1's cli.ts row is exact, and any import of storage.ts from a library module is a finding (L9, L14; lint class 12, file classes 2-4)", () => {
    const loadsStorage = "import { x } from './storage'\nexport const y = x"
    expect(
      reachOfFiles({ ...STORAGE_FILES, [PUBLISHER_CLI]: loadsStorage }),
      'precondition: tools/publisher/cli.ts importing ./storage gives no finding',
    ).toEqual([])
    const names: readonly (readonly [string, string])[] = [
      ['tools/publisher/Cli.ts', loadsStorage],
      ['tools/publisher/cli.mts', loadsStorage],
      ['tools/publisher/cli.ts/index.ts', "import { x } from '../storage'\nexport const y = x"],
      ['tools/publisher/x/cli.ts', "import { x } from '../storage'\nexport const y = x"],
      ['tools/cli.ts', "import { x } from './publisher/storage'\nexport const y = x"],
    ]
    for (const [path, text] of names) {
      expect
        .soft(
          loads(reachOfFiles({ ...STORAGE_FILES, [path]: text }), path, 'F1 storage client'),
          `(g1) ${path} reaching storage.ts is a finding`,
        )
        .toBe(true)
    }
    const library: readonly (readonly [string, Record<string, string>, string])[] = [
      [
        'a type-only import in stage.ts',
        {
          'tools/publisher/stage.ts':
            "import type { StorageClient } from './storage'\nexport type C = StorageClient",
        },
        'tools/publisher/stage.ts',
      ],
      [
        'export * in port.ts',
        { 'tools/publisher/port.ts': "export * from './storage'" },
        'tools/publisher/port.ts',
      ],
      [
        'two hops, report.ts > helper.ts > storage.ts',
        {
          'tools/publisher/report.ts': "import { h } from './helper'\nexport const r = h",
          'tools/publisher/helper.ts': "export { x as h } from './storage'",
        },
        'tools/publisher/report.ts',
      ],
    ]
    for (const [id, files, entry] of library) {
      expect
        .soft(
          loads(reachOfFiles({ ...STORAGE_FILES, ...files }), entry, 'F1 storage client'),
          `(g2) ${id} is a finding`,
        )
        .toBe(true)
    }
  })

  it('T15A-64 F5 and F6: hook.ts and verify.ts are reached only from themselves and cli.ts (CRIT-9; lint class 12, file classes 2-4)', () => {
    const fencedFiles = {
      'tools/publisher/hook.ts': 'export const h = 1',
      'tools/publisher/verify.ts': 'export const v = 1',
    } as const
    expect(
      reachOfFiles({
        ...fencedFiles,
        [PUBLISHER_CLI]:
          "import { h } from './hook'\nimport { v } from './verify'\nexport const c = [h, v]",
      }),
      'precondition: tools/publisher/cli.ts importing ./hook and ./verify gives no finding',
    ).toEqual([])
    // One shared sample table for both rows: [fence name, module name, a type it could export, the
    // src/core wrapper's path].
    const rows: readonly (readonly [string, string, string, string])[] = [
      ['F5 deploy hook', 'hook', 'HookOptions', 'src/core/net.ts'],
      ['F6 verify', 'verify', 'VerifyOptions', 'src/core/net2.ts'],
    ]
    for (const [fence, name, typeName, wrapper] of rows) {
      const samples: readonly (readonly [string, Record<string, string>, string])[] = [
        [
          `a src/core wrapper of ${name}.ts imported by publish.ts`,
          {
            [wrapper]: `export * from '../../tools/publisher/${name}'`,
            'tools/publisher/publish.ts': `import * as n from '../../${wrapper.slice(0, -3)}'\nexport const y = n`,
          },
          'tools/publisher/publish.ts',
        ],
        [
          `export * from './${name}' in port.ts`,
          { 'tools/publisher/port.ts': `export * from './${name}'` },
          'tools/publisher/port.ts',
        ],
        [
          `two hops, report.ts > helper.ts > ${name}.ts`,
          {
            'tools/publisher/report.ts': "import { h } from './helper'\nexport const r = h",
            'tools/publisher/helper.ts': `import * as m from './${name}'\nexport const h = m`,
          },
          'tools/publisher/report.ts',
        ],
        [
          `a type-only import of ${name}.ts in stage.ts`,
          {
            'tools/publisher/stage.ts': `import type { ${typeName} } from './${name}'\nexport type O = ${typeName}`,
          },
          'tools/publisher/stage.ts',
        ],
        [
          `tools/publisher/Cli.ts importing ./${name}`,
          { 'tools/publisher/Cli.ts': `import * as m from './${name}'\nexport const c = m` },
          'tools/publisher/Cli.ts',
        ],
        [
          `tools/publisher/cli.mts importing ./${name}`,
          { 'tools/publisher/cli.mts': `import * as m from './${name}'\nexport const c = m` },
          'tools/publisher/cli.mts',
        ],
      ]
      for (const [id, files, entry] of samples) {
        expect
          .soft(
            loads(reachOfFiles({ ...fencedFiles, ...files }), entry, fence),
            `(g1) ${fence}: ${id} is a finding`,
          )
          .toBe(true)
      }
    }
  })
})

// ---- the file walker (FS0; A32) ----

describe('the file walker (FS0)', () => {
  it('T13-FS0a in-memory tree: .env* is never read, unknown folders are findings, .github and every extension are read, runner tests and excluded folders are not', () => {
    const route = '/storage/v1/object/move'
    // Written out, not taken from the walker's own lists, so a walker that drops one is caught.
    const scriptSamples = Object.fromEntries(
      ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].map((ext) => [
        `scripts/sample.${ext}`,
        `export const u = '${route}'\n`,
      ]),
    )
    const textSamples = Object.fromEntries([
      ...['json', 'yml', 'yaml', 'ipynb', 'md', 'txt', 'sql', 'toml', 'sh', 'bash']
        .concat(['ps1', 'psm1', 'py', 'cmd', 'bat', 'html', 'xml', 'svg'])
        .map((ext) => [`scripts/sample.${ext}`, `${route}\n`]),
      ...['.gitignore', '.prettierignore', '.nvmrc'].map((name) => [
        `scripts/${name}`,
        `${route}\n`,
      ]),
    ])
    // The test files Vitest (src, tools, scripts: *.test.ts) and Playwright (e2e: *.spec|test.*) run.
    const runnerTests = Object.fromEntries(
      [
        'src/a.test.ts',
        'tools/publisher/a.test.ts',
        'scripts/sub/a.test.ts',
        'e2e/a.spec.ts',
        'e2e/sub/a.test.tsx',
        'e2e/a.spec.mjs',
      ].map((path) => [path, `export const u = '${route}'`]),
    )
    // Review fix SEC2-1: test-like names that no runner runs as a test (GitHub runs every workflow;
    // node runs the scripts), so each is read and scanned.
    const testNamed = Object.fromEntries([
      ['.github/workflows/x.test.yml', `run: curl -X DELETE "$U${route}"`],
      ['.github/workflows/x.spec.yaml', `run: curl -X DELETE "$U${route}"`],
      ['scripts/x.test.mjs', `export const u = '${route}'`],
      ['tools/x.spec.cjs', `module.exports = '${route}'`],
      ['src/x.test.cli.ts', `export const u = '${route}'`],
      ['src/a.test.tsx', `export const u = '${route}'`],
      ['scripts/.hidden/a.test.ts', `export const u = '${route}'`],
      ['e2e/.x/a.spec.ts', `export const u = '${route}'`],
      ['scripts/a.TEST.ts', `export const u = '${route}'`],
    ])
    // Review fix SEC2-3: .env-named entries .gitignore does not keep out (a folder, another name, a
    // case that Linux git does not ignore), each holding the S2 name and a route.
    const envNamed = Object.fromEntries(
      [
        'scripts/.envx/takedown.ts',
        'scripts/.env-tools/takedown.ts',
        'scripts/.env/takedown.ts',
        'scripts/.Env.ts',
        'tools/publisher/.environment.ts',
      ].map((path) => [
        path,
        `export const k = 'SUPABASE_SECRET_KEY'\nexport const u = '${route}'`,
      ]),
    )
    const files: Record<string, MemoryFile> = {
      '.env.production.json': '{ "k": "SUPABASE_SECRET_KEY" }',
      '.env.local': 'SUPABASE_SECRET_KEY=x',
      'scripts/.env.ts': "export const k = 'SUPABASE_SECRET_KEY'",
      'newdir/x.ts': `export const u = '${route}'`,
      '.github/workflows/x.yaml': `run: curl "${route}"`,
      '.github/actions/publish/action.yml': `run: curl "${route}"`,
      'node_modules/x/index.js': `module.exports = '${route}'`,
      'migration-input/x.ts': `export const u = '${route}'`,
      'scripts/x.ts/inner.ts': `export const u = '${route}'`,
      ...runnerTests,
      ...testNamed,
      ...envNamed,
      ...scriptSamples,
      ...textSamples,
    }
    expect(Object.keys(files).length, 'precondition: at least 14 samples').toBeGreaterThanOrEqual(
      14,
    )
    const scan = scanFiles(files)
    const flagged = (path: string) =>
      scan.findings.some((finding) => finding.startsWith(`${path}:`))
    for (const path of ['.env.production.json', '.env.local', 'scripts/.env.ts']) {
      expect.soft(scan.reads.includes(path), `(g1) ${path} is never read`).toBe(false)
      expect
        .soft(
          scan.walk.files.some((file) => file.path === path),
          `(g1) ${path} is never listed`,
        )
        .toBe(false)
    }
    expect
      .soft(
        [...scan.findings, ...scan.walk.findings].join(' ').toLowerCase().includes('.env'),
        '(g1) no finding names a .env* file',
      )
      .toBe(false)
    expect.soft(scan.walk.envSkipped, '(g1) the three gitignored names are counted').toBe(3)
    expect
      .soft(scan.walk.findings, '(g2) newdir is an unknown folder')
      .toContain('unknown-folder newdir')
    expect.soft(scan.reads.includes('newdir/x.ts'), '(g2) and is not read').toBe(false)
    for (const path of ['.github/workflows/x.yaml', '.github/actions/publish/action.yml']) {
      expect
        .soft(scan.reads.includes(path) && flagged(path), `(g3) ${path} is read and flagged`)
        .toBe(true)
    }
    for (const path of [...Object.keys(scriptSamples), ...Object.keys(textSamples)]) {
      expect.soft(flagged(path), `(g4) ${path} is read and flagged`).toBe(true)
    }
    for (const path of [
      'node_modules/x/index.js',
      'migration-input/x.ts',
      ...Object.keys(runnerTests),
    ]) {
      expect.soft(scan.reads.includes(path), `(g5) ${path} is not read`).toBe(false)
    }
    expect
      .soft(flagged('scripts/x.ts/inner.ts'), '(g6) a folder named x.ts/ is walked as a folder')
      .toBe(true)
    expect
      .soft(
        [...scan.walk.findings].sort(),
        '(g6) and only newdir and the .env-named entries are walker findings',
      )
      .toEqual([
        'env-named-entry scripts',
        'env-named-entry scripts',
        'env-named-entry scripts',
        'env-named-entry scripts',
        'env-named-entry tools/publisher',
        'unknown-folder newdir',
      ])
    for (const path of Object.keys(testNamed)) {
      expect
        .soft(
          scan.reads.includes(path) && flagged(path),
          `(g7) ${path}, which no runner runs as a test, is read and flagged`,
        )
        .toBe(true)
    }
    for (const path of Object.keys(envNamed)) {
      expect.soft(scan.reads.includes(path), `(g8) ${path} is never read`).toBe(false)
      expect
        .soft(
          scan.walk.files.some((file) => file.path === path),
          `(g8) ${path} is never listed`,
        )
        .toBe(false)
    }
    expect
      .soft(
        scan.walk.findings.filter((finding) => finding.startsWith('env-named-entry ')).length,
        '(g8) each .env-named entry .gitignore does not keep out is a finding naming its folder',
      )
      .toBe(Object.keys(envNamed).length)
    // Review fix SEC3-4: .gitignore:11 (`!.env.example`) keeps `.env.example` committable, and git on
    // Windows (core.ignorecase) reads that negation in any case, so it is a finding naming its folder
    // in any case. A near miss .gitignore still keeps out (`.env.*`) is counted, as before.
    const example = scanFiles({
      'scripts/.env.example': "export const k = 'SUPABASE_SECRET_KEY'",
      'tools/publisher/.env.EXAMPLE': "export const k = 'SUPABASE_SECRET_KEY'",
      'scripts/.env.example.local': 'SUPABASE_SECRET_KEY=x',
      'scripts/.env.examples': 'SUPABASE_SECRET_KEY=x',
      'scripts/ok.ts': 'export const ok = 1',
    })
    for (const path of [
      'scripts/.env.example',
      'tools/publisher/.env.EXAMPLE',
      'scripts/.env.example.local',
      'scripts/.env.examples',
    ]) {
      expect.soft(example.reads.includes(path), `(g9) ${path} is never read`).toBe(false)
      expect
        .soft(
          example.walk.files.some((file) => file.path === path),
          `(g9) ${path} is never listed`,
        )
        .toBe(false)
    }
    expect
      .soft(
        [...example.walk.findings].sort(),
        '(g9) .env.example, in any case, is a finding naming its folder',
      )
      .toEqual(['env-named-entry scripts', 'env-named-entry tools/publisher'])
    expect
      .soft(
        example.walk.envSkipped,
        '(g9) the near misses .gitignore keeps out (.env.example.local, .env.examples) are counted',
      )
      .toBe(2)
  })

  it(
    'T13-FS0b real tree: no .env* name listed or read, every top-level folder walked or excluded, the workflows read',
    { timeout: WALK_TIMEOUT },
    () => {
      const { walk } = real.scan
      const counts = new Map<string, number>()
      for (const file of walk.files) {
        if (file.text === null) continue
        const top = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '(root)'
        counts.set(top, (counts.get(top) ?? 0) + 1)
      }
      console.log(
        `fence walk read per folder: ${[...counts].map(([top, count]) => `${top} ${count}`).join(', ')}; ` +
          `.env* names skipped unread: ${walk.envSkipped}`,
      )
      const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1).toLowerCase()
      // Counts, not the items, so no listed file, read text or .env* name reaches a failure message
      // (lead decision §20, FS0b prints option a).
      expect
        .soft(
          walk.files.filter((file) => basename(file.path).startsWith('.env')).length,
          '(g1) no .env* name listed',
        )
        .toBe(0)
      expect
        .soft(
          real.reads.filter((path) => basename(path).startsWith('.env')).length,
          '(g1) no .env* name read',
        )
        .toBe(0)
      // A .env-named folder, in any case, is left out of the loop, so its name never reaches a
      // message; the walker reports it as `env-named-entry .` in '(g2) no walker finding'.
      const top = realReader()
        .list('')
        .filter((entry) => entry.kind === 'dir' && !entry.name.toLowerCase().startsWith('.env'))
        .map((entry) => entry.name)
      for (const name of top) {
        expect
          .soft(
            TOP_WALKED.has(name) || TOP_EXCLUDED.has(name),
            `(g2) ${name} is walked or excluded`,
          )
          .toBe(true)
      }
      expect.soft(walk.findings, '(g2) no walker finding').toEqual([])
      for (const path of [
        '.github/workflows/ci.yml',
        '.github/workflows/keep-alive.yml',
        '.github/workflows/live-check.yml',
      ]) {
        expect.soft(realRead(path), `(g3) ${path} is read`).toBe(true)
      }
      expect
        .soft(
          walk.files.filter((file) => file.text !== null).length,
          '(g4) at least 190 files read',
        )
        .toBeGreaterThanOrEqual(190)
    },
  )

  it('T13-FS0c fail closed: unreadable and vanished files, syntax errors and a zero-file walk are findings; empty files and every script kind read cleanly', () => {
    const scan = scanFiles({
      'scripts/a.ts': { error: 'EACCES' },
      'scripts/b.ts': { error: 'ENOENT' },
      'scripts/empty.ts': '',
      'scripts/x.ts': 'const x = ;',
      'src/k.tsx': 'export const A = ({ s }: { s: any }) => <div>{s.reveal()}</div>',
      'src/k.jsx': 'export const A = ({ s }) => <div>{s.reveal()}</div>',
      'scripts/k.mjs': 'export const f = (s) => s.reveal()',
      'scripts/k.cjs': 'module.exports = (s) => s.reveal()',
    })
    expect(scan.reads.length, 'precondition: 6 or more samples read').toBeGreaterThanOrEqual(6)
    expect
      .soft(scan.walk.findings, '(g1) the unreadable file is a finding')
      .toContain('unreadable scripts/a.ts')
    expect
      .soft(scan.walk.findings, '(g1) the vanished file is a finding')
      .toContain('unreadable scripts/b.ts')
    expect
      .soft(scan.walk.findings.join(' ').includes('Q7MARK'), '(g1) findings name only the path')
      .toBe(false)
    expect
      .soft(
        scan.walk.files.some((file) => file.path === 'scripts/empty.ts' && file.text === ''),
        '(g2) the empty file is read',
      )
      .toBe(true)
    expect
      .soft(
        scan.findings.filter((finding) => finding.startsWith('scripts/empty.ts')),
        '(g2) and is clean',
      )
      .toEqual([])
    expect
      .soft(scan.walk.findings, '(g3) a syntax error is a finding (PR-4)')
      .toContain('parse-error scripts/x.ts')
    for (const path of ['src/k.tsx', 'src/k.jsx', 'scripts/k.mjs', 'scripts/k.cjs']) {
      expect
        .soft(
          scan.findings.filter((finding) => finding.startsWith(`${path}:`)),
          `(g4) ${path} gives exactly one S3 finding`,
        )
        .toEqual([`${path}:1 s3-reveal`])
      expect
        .soft(scan.walk.findings.includes(`parse-error ${path}`), `(g4) ${path} parses`)
        .toBe(false)
    }
    expect.soft(scan.walk.findings.length, '(g4) no other walker finding').toBe(3)
    const empty = scanFiles({ 'public/x.png': 'not read', 'scripts/a.ts': { error: 'EACCES' } })
    expect
      .soft(empty.walk.findings, '(g5) a walk with no readable file is a finding')
      .toContain('empty-walk')
    expect.soft(scanFiles({}).walk.findings, '(g5) so is an empty tree').toEqual(['empty-walk'])
  })

  it(
    'T13-FS0d every extension has a class: text files are read, inert files are not, unknown extensions are findings',
    { timeout: WALK_TIMEOUT },
    () => {
      const scan = scanFiles({
        'scripts/x.sh': 'curl -X DELETE "$U/storage/v1/object/masters/x"',
        'tools/x.ps1': 'Invoke-RestMethod -Method Delete "$u/storage/v1/object/content/x"',
        'tools/x.py': "k = 'sb_secret_'",
        'supabase/x.toml': 'u = "/storage/v1/object/move"',
        'src/x.md': 'Send it to /storage/v1/object/move',
        'src/x.css': '.a { background: url(/storage/v1/object/move) }',
        'public/x.png': '/storage/v1/object/move',
        'src/x.xyz': '/storage/v1/object/move',
        'scripts/Makefile': 'x:\n\tcurl /storage/v1/object/move',
        'scripts/.gitignore': '.env*\n.env.local',
        'scripts/.prettierignore': '.env.local',
        'scripts/ok.ts': 'export const ok = 1',
      })
      const expected = [
        ['scripts/x.sh', 's1-route'],
        ['tools/x.ps1', 's1-route'],
        ['tools/x.py', 's2-marker'],
        ['supabase/x.toml', 's1-route'],
        ['src/x.md', 's1-route'],
      ] as const
      for (const [path, form] of expected) {
        expect.soft(scan.findings, `(g1) ${path} gives ${form}`).toContain(`${path}:1 ${form}`)
      }
      for (const path of ['src/x.css', 'public/x.png']) {
        expect.soft(scan.reads.includes(path), `(g2) ${path} is not read`).toBe(false)
        expect
          .soft(
            scan.walk.files.some((file) => file.path === path && file.cls === 'inert'),
            `(g2) ${path} is inert`,
          )
          .toBe(true)
      }
      expect
        .soft(scan.walk.findings, '(g3) an unknown extension is a finding')
        .toContain('unknown-extension xyz')
      expect
        .soft(scan.walk.findings, '(g3) so is a name with none')
        .toContain('unknown-extension (none)')
      for (const path of ['scripts/.gitignore', 'scripts/.prettierignore']) {
        expect.soft(scan.reads.includes(path), `(g4) ${path} is read as text`).toBe(true)
        expect
          .soft(
            scan.findings.filter((finding) => finding.startsWith(`${path}:`)),
            `(g4) ${path} gives no env-file finding`,
          )
          .toEqual([])
      }
      const census = new Map<string, number>()
      for (const file of real.scan.walk.files) {
        const key = file.ext || file.path.slice(file.path.lastIndexOf('/') + 1)
        census.set(key, (census.get(key) ?? 0) + 1)
      }
      console.log(
        `fence walk extension census: ${[...census]
          .sort()
          .map(([ext, count]) => `${ext} ${count}`)
          .join(', ')}`,
      )
      expect
        .soft(
          real.scan.walk.findings.filter((finding) => finding.startsWith('unknown-extension')),
          '(g5) the real tree has no unknown extension',
        )
        .toEqual([])
      for (const ext of ['ts', 'tsx', 'json', 'sql', 'toml', 'ipynb']) {
        expect(census.has(ext), `precondition: the real census includes ${ext}`).toBe(true)
      }
    },
  )

  it(
    'T13-FS0e the repository root: .github, storyboard and docs/ (without docs/design) are walked, README.md, .gitignore and .gitattributes are read as text, pt/ and the PC-only names are excluded by name and each gitignored reason holds in the real .gitignore, any other root entry is a finding and no link is followed; the real root is clean',
    { timeout: WALK_TIMEOUT },
    () => {
      // Review fix SEC2-6 (design §17). A '../<name>' key is a repository-root entry. Written out, not
      // taken from the walker's own lists, so a walker that drops one is caught.
      const route = '/storage/v1/object/move'
      const rootText = ['../README.md', '../.gitignore', '../.gitattributes']
      const excluded = [
        '../pt/src/x.js',
        '../pt/package.json',
        '../.git/config',
        '../.claude/settings.json',
        '../.code-review-graph/graph.json',
        '../.mcp.json',
        '../CLAUDE.md',
        '../.impeccable/hook.cache.json',
        '../docs/design/x.md',
      ]
      // Any other entry, the bypass forms of a name guard included (guard-bypass-catalogue.md, file
      // guards): another case of an excluded, walked or text name (3) and near misses (5).
      const unknown = [
        '../newroot/x.ts',
        '../run.mjs',
        '../Makefile',
        '../PT/x.js',
        '../Storyboard/x.ts',
        '../readme.md',
        '../pt-old/x.js',
        '../.git-backup/config',
        '../README.md.bak',
      ]
      const files: Record<string, MemoryFile> = {
        'scripts/x.ts': `export const u = '${route}'`,
        '.github/workflows/x.yml': `run: curl "${route}"`,
        '../README.md': `Send it to ${route}`,
        '../.gitignore': `${route}\n.env*`,
        '../.gitattributes': `${route} text=auto eol=lf`,
        '../.env.local': 'SUPABASE_SECRET_KEY=x',
        '../.envx/x.ts': "export const k = 'SUPABASE_SECRET_KEY'",
        ...Object.fromEntries(
          [...excluded, ...unknown].map((path) => [path, `export const u = '${route}'`]),
        ),
      }
      const scan = scanFiles(files)
      const flagged = (path: string) =>
        scan.findings.some((finding) => finding.startsWith(`${path}:`))
      const listed = (path: string) => scan.walk.files.some((file) => file.path === path)
      for (const path of ['scripts/x.ts', '.github/workflows/x.yml']) {
        expect
          .soft(scan.reads.includes(path) && flagged(path), `(g1) ${path} is walked and flagged`)
          .toBe(true)
      }
      for (const path of rootText) {
        expect.soft(scan.reads.includes(path), `(g2) ${path} is read`).toBe(true)
        expect
          .soft(scan.walk.files.find((file) => file.path === path)?.cls, `(g2) ${path} is text`)
          .toBe('text')
        expect
          .soft(scan.findings, `(g2) ${path} goes through the scans`)
          .toContain(`${path}:1 s1-route`)
      }
      for (const path of excluded) {
        expect
          .soft(
            scan.reads.includes(path) || listed(path) || flagged(path),
            `(g3) ${path} is excluded by name: not read, listed or flagged`,
          )
          .toBe(false)
      }
      expect
        .soft(scan.walk.findings, '(g4) newroot at the root is an unknown folder')
        .toContain('unknown-folder newroot')
      expect
        .soft(scan.walk.findings, '(g4) run.mjs at the root is an unknown root file')
        .toContain('unknown-extension mjs')
      expect
        .soft(scan.walk.findings, '(g4) so is Makefile at the root')
        .toContain('unknown-extension (none)')
      for (const [finding, form] of [
        ['unknown-folder PT', 'PT/ (case of pt/)'],
        ['unknown-folder Storyboard', 'Storyboard/ (case of storyboard/)'],
        ['unknown-extension md', 'readme.md (case of README.md)'],
        ['unknown-folder pt-old', 'pt-old/ (near miss)'],
        ['unknown-folder .git-backup', '.git-backup/ (near miss)'],
        ['unknown-extension bak', 'README.md.bak (near miss)'],
      ]) {
        expect.soft(scan.walk.findings, `(g4) ${form} is a finding`).toContain(finding)
      }
      for (const path of unknown) {
        expect
          .soft(scan.reads.includes(path) || listed(path), `(g4) ${path} is not read`)
          .toBe(false)
      }
      expect
        .soft(
          scan.reads.some((path) => path.toLowerCase().includes('.env')),
          '(g5) no .env name at the root is read',
        )
        .toBe(false)
      expect.soft(scan.walk.envSkipped, '(g5) the root .env.local is counted').toBe(1)
      // Review fix SEC3-4: the root .gitignore's own negation (line 11) keeps `.env.example` committable.
      const example = scanFiles({
        '../.env.example': 'SUPABASE_SECRET_KEY=x',
        'scripts/ok.ts': 'export const ok = 1',
      })
      expect
        .soft(example.reads.includes('../.env.example'), '(g5) the root .env.example is never read')
        .toBe(false)
      expect
        .soft(
          [example.walk.findings, example.walk.envSkipped],
          '(g5) and is a finding naming only .., not counted',
        )
        .toEqual([['env-named-entry ..'], 0])
      expect
        .soft(
          [...scan.walk.findings].sort(),
          '(g6) and the root gives only these walker findings (excluded names give none)',
        )
        .toEqual([
          'env-named-entry ..',
          'unknown-extension (none)',
          'unknown-extension bak',
          'unknown-extension md',
          'unknown-extension mjs',
          'unknown-folder .git-backup',
          'unknown-folder PT',
          'unknown-folder Storyboard',
          'unknown-folder newroot',
          'unknown-folder pt-old',
        ])
      // File forms (2): a folder named like a root text file, a file named like a walked folder.
      const kinds = scanFiles({
        '../.git': 'gitdir: ../x',
        '../.gitattributes/x.ts': `export const u = '${route}'`,
        '../.github': `run: curl "${route}"`,
        '../README.md': { error: 'EACCES' },
        'scripts/ok.ts': 'export const ok = 1',
      })
      for (const path of ['../.git', '../.gitattributes/x.ts', '../.github']) {
        expect.soft(kinds.reads.includes(path), `(g7) ${path} is not read`).toBe(false)
      }
      expect
        .soft(kinds.walk.findings, '(g7) a folder named .gitattributes is an unknown folder')
        .toContain('unknown-folder .gitattributes')
      expect
        .soft(kinds.walk.findings, '(g7) a file named .github is an unknown root file')
        .toContain('unknown-extension (none)')
      expect
        .soft(kinds.walk.findings, '(g7) an unreadable root file is a finding')
        .toContain('unreadable ../README.md')
      expect
        .soft(
          [...kinds.walk.findings].sort(),
          '(g7) and a .git file (a worktree) is excluded by name whatever its kind',
        )
        .toEqual([
          'unknown-extension (none)',
          'unknown-folder .gitattributes',
          'unreadable ../README.md',
        ])
      // The printed root listing counts `.env*` names and never names one (review fix R3T-2).
      const printed = shownNames([
        { name: '.env.local', kind: 'file' },
        { name: '.ENVX', kind: 'dir' },
        { name: 'README.md', kind: 'file' },
        { name: 'pt', kind: 'dir' },
      ])
      expect
        .soft(printed.names, '(g8) the printed listing never names a .env* entry')
        .toEqual(['README.md', 'pt/'])
      expect.soft(printed.envHidden, '(g8) and counts each one').toBe(2)
      const root = shownNames(realReader().list('..'))
      console.log(
        `fence walk repository root: ${root.names.join(', ')}; .env* names not shown: ${root.envHidden}`,
      )
      for (const name of ['storyboard/', '.github/', 'pt/', ...rootText.map((p) => p.slice(3))]) {
        expect(root.names, `precondition: the repository root holds ${name}`).toContain(name)
      }
      for (const path of rootText) {
        expect.soft(realRead(path), `(g8) the real ${path} is read`).toBe(true)
      }
      expect
        .soft(
          real.scan.findings.filter((finding) => finding.startsWith('../')),
          '(g8) the real root files are clean',
        )
        .toEqual([])
      // docs/ is walked like any root folder (lead decision §20); g10 checks the real docs/design.
      expect
        .soft(
          real.reads.filter(
            (path) =>
              path.startsWith('../') && !rootText.includes(path) && !path.startsWith('../docs/'),
          ),
          '(g8) nothing else at the real root is read',
        )
        .toEqual([])
      expect.soft(real.scan.walk.findings, '(g8) the real root gives no walker finding').toEqual([])
      // Links (review fix SEC3-3): a link or junction is never followed or read, at the root and below,
      // and is `unreadable <path>`; a link named like a walked folder or a root text file is no
      // exception. With storyboard a link, ../.gitignore keeps the walk from being empty, so this
      // finding is all that reports the skipped tree.
      const links = scanFiles({
        '../linked': { link: true },
        '../storyboard': { link: true },
        '../README.md': { link: true },
        '../.gitignore': 'node_modules/',
        'scripts/x.ts': `export const u = '${route}'`,
      })
      const nested = scanFiles({
        'scripts/linked.ts': { link: true },
        'scripts/ok.ts': 'export const ok = 1',
      })
      expect(
        links.reads,
        'precondition: ../.gitignore is read, so the walk is not empty',
      ).toContain('../.gitignore')
      for (const path of ['../linked', '../storyboard', '../README.md']) {
        expect.soft(links.reads.includes(path), `(g9) ${path}, a link, is never read`).toBe(false)
      }
      expect
        .soft(
          nested.reads.includes('scripts/linked.ts'),
          '(g9) scripts/linked.ts, a link, is never read',
        )
        .toBe(false)
      expect
        .soft(links.walk.findings, '(g9) a link at the root is a finding')
        .toContain('unreadable ../linked')
      expect
        .soft(links.walk.findings, '(g9) a link named storyboard is a finding')
        .toContain('unreadable ../storyboard')
      expect
        .soft(links.reads.includes('scripts/x.ts'), "(g9) and storyboard's tree is not walked")
        .toBe(false)
      expect
        .soft(links.walk.findings, '(g9) a link named README.md is a finding')
        .toContain('unreadable ../README.md')
      expect
        .soft(nested.walk.findings, '(g9) a link under storyboard is a finding')
        .toContain('unreadable scripts/linked.ts')
      // docs/ (lead decision §20, SEC3-2 option b): walked like any root folder, with docs/design
      // excluded by its path from the root and only as a folder, which is what `/docs/design/` in the
      // root .gitignore ignores. CI's checkout has no docs/, so the walk must not need one.
      const docs = scanFiles({
        '../docs/notes.md': `Send it to ${route}`,
        '../docs/tools/x.ts': `export const u = '${route}'`,
        '../docs/design/x.md': `Send it to ${route}`,
        '../docs/design/inputs/y.ts': `export const u = '${route}'`,
        '../docs/Design/x.md': `Send it to ${route}`,
        '../docs/design-notes/x.md': `Send it to ${route}`,
        '../docs/sub/design/x.md': `Send it to ${route}`,
        'scripts/ok.ts': 'export const ok = 1',
      })
      const docsFlagged = (path: string) =>
        docs.findings.some((finding) => finding.startsWith(`${path}:`))
      for (const [path, form] of [
        ['../docs/notes.md', 'a text file under docs/'],
        ['../docs/tools/x.ts', 'a script under docs/'],
        ['../docs/Design/x.md', 'Design/ (case of docs/design)'],
        ['../docs/design-notes/x.md', 'design-notes/ (near miss)'],
        ['../docs/sub/design/x.md', 'a design/ below docs/design (near miss)'],
      ] as const) {
        expect
          .soft(
            docs.reads.includes(path) && docsFlagged(path),
            `(g10) ${path}, ${form}, is walked and flagged`,
          )
          .toBe(true)
      }
      expect
        .soft(entriesOf(docs.walk), '(g10) and a script under docs/ is a reach entry')
        .toContain('../docs/tools/x.ts')
      for (const path of ['../docs/design/x.md', '../docs/design/inputs/y.ts']) {
        expect
          .soft(
            docs.reads.includes(path) ||
              docs.walk.files.some((file) => file.path === path) ||
              docsFlagged(path),
            `(g10) ${path} is excluded: not read, listed or flagged`,
          )
          .toBe(false)
      }
      expect.soft(docs.walk.findings, '(g10) and docs/ gives no walker finding').toEqual([])
      // File forms (2): `/docs/design/` ignores only a folder, so a file or a link named docs/design is
      // committable: it is a finding and is never read. A file named docs at the root is no folder.
      for (const [file, finding, form] of [
        [`Send it to ${route}`, 'unknown-extension (none)', 'a file'],
        [{ link: true }, 'unreadable ../docs/design', 'a link'],
      ] as const) {
        const kind = scanFiles({ '../docs/design': file, 'scripts/ok.ts': 'export const ok = 1' })
        expect
          .soft(
            kind.reads.includes('../docs/design'),
            `(g10) ${form} named docs/design is never read`,
          )
          .toBe(false)
        expect
          .soft(kind.walk.findings, `(g10) and ${form} named docs/design is a finding`)
          .toEqual([finding])
      }
      const docsFile = scanFiles({
        '../docs': `Send it to ${route}`,
        'scripts/ok.ts': 'export const ok = 1',
      })
      expect
        .soft(docsFile.reads.includes('../docs'), '(g10) a file named docs at the root is not read')
        .toBe(false)
      expect
        .soft(docsFile.walk.findings, '(g10) and is an unknown root file')
        .toEqual(['unknown-extension (none)'])
      const noDocs = scanFiles({
        'scripts/x.ts': `export const u = '${route}'`,
        '../README.md': 'x',
      })
      expect
        .soft(
          noDocs.walk.findings,
          "(g10) a root with no docs/ (CI's checkout) gives no walker finding",
        )
        .toEqual([])
      expect
        .soft(
          [...real.reads, ...real.scan.walk.files.map((file) => file.path)].filter(
            (path) => path === '../docs/design' || path.startsWith('../docs/design/'),
          ),
          '(g10) the real docs/design is never listed or read',
        )
        .toEqual([])
      // Every excluded name whose reason says gitignored is ignored whole by the root .gitignore (lead
      // decision §20, SEC3-2 option b), so a plain `git add` cannot put a file under a skipped name in
      // CI's checkout. A force-added (tracked) file is not covered: .gitignore never applies to it
      // (the §6 T13 residual; review fix SEC5-3). Samples through the memory reader first; the real
      // ../.gitignore, through the real reader, last.
      const sampleExcluded = new Map([
        ['.cache', 'tool cache; gitignored; this PC only'],
        ['docs/x', 'gitignored /docs/x/; notes'],
        ['kept', 'tracked on purpose'],
        ['loose', 'cache; not gitignored'],
      ])
      const gapsOf = (gitignore: MemoryFile) =>
        gitignoreGaps(memoryReader({ '../.gitignore': gitignore }, []), sampleExcluded)
      expect
        .soft(gapsOf('').checked, '(g11) only the names whose reason says gitignored are checked')
        .toEqual(['.cache', 'docs/x'])
      expect
        .soft(
          gapsOf('node_modules/\n').gaps,
          '(g11) a reason that says gitignored with no matching pattern is a failure',
        )
        .toEqual(['.cache', 'docs/x'])
      for (const form of ['/N/', '/N', 'N/', 'N', '**/N/']) {
        const gitignore = ['.cache', 'docs/x'].map((name) => form.replace('N', name)).join('\n')
        expect.soft(gapsOf(gitignore).gaps, `(g11) ${form} ignores a name whole`).toEqual([])
      }
      for (const [line, form] of [
        ['!.cache', 'a negated pattern does not count'],
        ['/.cache/\n!/.cache/', 'a later negation re-includes it'],
        ['/.CACHE/', 'another case does not count (CI reads .gitignore case-sensitively)'],
        ['/.cache-old/', 'a near miss does not count'],
        ['/sub/.cache/', 'a deeper path does not count'],
        ['/.cache/x', 'a path inside it does not count'],
        ['/.cache*', 'a wildcard does not count (fail closed)'],
        ['./.cache/', 'a dot segment does not count'],
        ['# /.cache/', 'a comment does not count'],
      ]) {
        expect.soft(gapsOf(`${line}\n/docs/x/\n`).gaps, `(g11) ${form}`).toEqual(['.cache'])
      }
      expect
        .soft(gapsOf('!.cache\n/.cache/\n/docs/x/').gaps, '(g11) a later pattern ignores it again')
        .toEqual([])
      expect
        .soft(
          gapsOf('/.cache/  \r\n/docs/x/\r\n').gaps,
          '(g11) trailing spaces and CRLF line ends are read as git reads them',
        )
        .toEqual([])
      expect
        .soft(
          gapsOf({ error: 'EACCES' }).gaps,
          '(g11) an unreadable .gitignore leaves every checked name a failure',
        )
        .toEqual(['.cache', 'docs/x'])
      // Negations git reads as the name (review fix SEC5-1; each probed with git check-ignore): a
      // wildcard, a class or an escape re-includes it (fail closed), and so do a pattern with no `/`
      // at any depth and another case (core.ignorecase on Windows). A later pattern still ignores it
      // again. A negation of another path, a deeper one, one inside, or one with a dot segment or a
      // doubled `/` does not count, as git reads them.
      for (const [gitignore, gaps, form] of [
        ['/.cache/\n!/.cach*/\n/docs/x/', ['.cache'], 'a later wildcard negation re-includes it'],
        ['/.cache/\n!/.cach?/\n/docs/x/', ['.cache'], 'a later ? negation re-includes it'],
        ['/.cache/\n![.]cache/\n/docs/x/', ['.cache'], 'a later class negation re-includes it'],
        ['/.cache/\n!/\\.cache/\n/docs/x/', ['.cache'], 'a later escaped negation re-includes it'],
        [
          '/.cache/\n!*\n/docs/x/',
          ['.cache'],
          'a later !* re-includes it, and docs/x is ignored again',
        ],
        [
          '/.cache/\n!/.CACHE/\n/docs/x/',
          ['.cache'],
          'a later negation in another case re-includes it',
        ],
        [
          '/.cache/\n/docs/x/\n!x/',
          ['docs/x'],
          'a later negation with no / re-includes a nested name',
        ],
        [
          '/.cache/\n!/.cach*/\n/.cache/\n/docs/x/',
          [],
          'a later pattern ignores it after a wildcard',
        ],
        ['/.cache/\n/docs/x/\n!/x/', [], 'a negation of another path from the root does not count'],
        ['/.cache/\n/docs/x/\n!/sub/.cache/', [], 'a negation of a deeper path does not count'],
        ['/.cache/\n/docs/x/\n!/.cache/x', [], 'a negation of a path inside does not count'],
        [
          '/.cache/\n/docs/x/\n!./.cache/\n!docs//x/',
          [],
          'a dot segment or a doubled / does not count',
        ],
        ['/.cache/\n/docs/x/\n*.log', [], 'a wildcard pattern that is not negated changes nothing'],
      ] as const) {
        expect.soft(gapsOf(gitignore).gaps, `(g11) ${form}`).toEqual(gaps)
      }
      expect
        .soft(
          gitignoreGaps(
            memoryReader({ '../.gitignore': '/NOTES.md\n!*.md\n' }, []),
            new Map([['NOTES.md', 'notes; gitignored']]),
          ).gaps,
          '(g11) a later extension wildcard negation re-includes a .md name',
        )
        .toEqual(['NOTES.md'])
      // A .gitignore between the root and a nested name (review fix SEC5-2): git reads it over the
      // root one, so it could re-include the name; the name fails closed whatever the file holds, in
      // any case and of any kind. One inside the ignored folder, beside it, at storyboard's top, or
      // under another name does not count; nor does docs/ alone. An unlistable folder fails closed.
      const nestedGaps = (files: Readonly<Record<string, MemoryFile>>) =>
        gitignoreGaps(
          memoryReader({ '../.gitignore': '/.cache/\n/docs/x/\n', ...files }, []),
          sampleExcluded,
        ).gaps
      for (const [files, gaps, form] of [
        [{ '../docs/y.md': 'y' }, [], 'docs/ with no .gitignore gives no failure'],
        [{ '../docs/.gitignore': '!/x/' }, ['docs/x'], 'a .gitignore on the way fails the name'],
        [
          { '../docs/.gitignore': '# notes' },
          ['docs/x'],
          'whatever the .gitignore on the way holds',
        ],
        [{ '../docs/.GITIGNORE': '!/x/' }, ['docs/x'], 'a .GITIGNORE on the way (another case)'],
        [
          { '../docs/.gitignore': { link: true } },
          ['docs/x'],
          'a link named .gitignore on the way',
        ],
        [
          { '../docs/x/.gitignore': '!*' },
          [],
          'a .gitignore inside the ignored folder does not count',
        ],
        [{ '../docs/sub/.gitignore': '!*' }, [], 'a .gitignore beside it does not count'],
        [{ '.gitignore': '!*' }, [], "storyboard's own .gitignore does not count"],
        [{ '../docs/.gitignore.bak': '!/x/' }, [], 'another name does not count'],
      ] as const) {
        expect.soft(nestedGaps(files), `(g11) ${form}`).toEqual(gaps)
      }
      const unlistable = memoryReader(
        { '../.gitignore': '/.cache/\n/docs/x/\n', '../docs/y.md': 'y' },
        [],
      )
      expect
        .soft(
          gitignoreGaps(
            {
              list: (dir) => {
                if (dir === '../docs') throw new Error('EACCES')
                return unlistable.list(dir)
              },
              read: (path) => unlistable.read(path),
            },
            sampleExcluded,
          ).gaps,
          '(g11) a folder on the way that cannot be listed fails the name closed',
        )
        .toEqual(['docs/x'])
      const realGitignore = gitignoreGaps(
        realReader(),
        new Map([...ROOT_EXCLUDED, ...ROOT_NESTED_EXCLUDED]),
      )
      expect(
        realGitignore.checked,
        'precondition: the excluded names whose reason says gitignored',
      ).toEqual([
        '.claude',
        '.code-review-graph',
        '.impeccable',
        '.mcp.json',
        'CLAUDE.md',
        'docs/design',
      ])
      expect
        .soft(
          realGitignore.gaps,
          '(g11) every excluded name whose reason says gitignored is ignored whole by the real ../.gitignore',
        )
        .toEqual([])
    },
  )
})

// ---- S1, the Storage request surface (FS1; A17) ----

describe('S1: the Storage request surface (FS1)', () => {
  it(
    'T13-FS1a real tree: no S1 finding outside the allow-list, and every must-hold S1 cell is in use',
    { timeout: WALK_TIMEOUT },
    () => {
      for (const path of [
        'tools/publisher/storage.ts',
        'tools/publisher/storage-stub.ts',
        'src/config/security-headers.ts',
        '.github/workflows/keep-alive.yml',
      ]) {
        expect(realRead(path), `precondition: ${path} was read`).toBe(true)
      }
      expect
        .soft(
          real.scan.findings.filter((finding) => / s1-/.test(finding)),
          '(g1) no S1 finding',
        )
        .toEqual([])
      expect
        .soft(unusedAllowances(real.scan.hits, 's1'), '(g2) every must-hold S1 cell holds a hit')
        .toEqual([])
      expect
        .soft(
          realHits('.github/workflows/keep-alive.yml', 's1-route'),
          '(g3) keep-alive.yml routes at :107, :109',
        )
        .toEqual([107, 109])
      expect
        .soft(
          realHits('.github/workflows/keep-alive.yml', 's1-apikey'),
          '(g3) keep-alive.yml apikey at :56',
        )
        .toEqual([56])
      expect
        .soft(
          real.scan.hits.filter((hit) => hit.path === 'supabase/config.toml'),
          '(g4) supabase/config.toml (:256 "# user = \\"apikey\\"") gives no hit',
        )
        .toEqual([])
    },
  )

  it('T13-FS1b form a, route text: every non-public route is flagged, raw, cooked and JSON-decoded; public paths are not', () => {
    expectSamples('g1', ROUTE_SAMPLES)
    const headers = readFileSync(join(ROOT, 'src', 'config', 'security-headers.ts'), 'utf8')
    expect
      .soft(
        scanFiles({ 'src/config/security-headers.ts': headers }).findings,
        '(g2) n3 the real security-headers.ts',
      )
      .toEqual([])
  })

  it('T13-FS1c form b, `@supabase/` specifiers in every import form; not text that is not a specifier', () => {
    expectSamples('g1', SUPABASE_SAMPLES)
    const eslint = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8')
    expect(
      eslint.includes("'@supabase/*'"),
      'precondition: eslint.config.mjs holds the lint option',
    ).toBe(true)
    expect
      .soft(scanFiles({ 'eslint.config.mjs': eslint }).findings, '(g2) the real eslint.config.mjs')
      .toEqual([])
  })

  it('T13-FS1d form c, Supabase CLI storage text; not prose', () => {
    expectSamples('g1', CLI_SAMPLES)
  })

  it('T13-FS1e form d, the apikey header name in literals, property names and text; per form, per file', () => {
    expectSamples('g1', APIKEY_SAMPLES)
    const config = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8')
    expect(
      config.includes('# user = "apikey"'),
      'precondition: config.toml holds the SMTP comment',
    ).toBe(true)
    expect
      .soft(
        scanFiles({ 'supabase/config.toml': config }).findings,
        '(g2) the real supabase/config.toml',
      )
      .toEqual([])
  })

  it('T13-FS1f form e, x-upsert outside storage.ts and the stub, keep-alive.yml included', () => {
    expectSamples('g1', UPSERT_SAMPLES)
  })

  it('T13-FS1g documented limits: names assembled at run time are not flagged (catalogue class 13)', () => {
    expectSamples('limit', S1_LIMIT_SAMPLES)
  })
})

// ---- S2, the key's reach (FS2; A33) ----

describe("S2: the key's reach (FS2)", () => {
  it(
    "T13-FS2a real tree: no S2 finding outside env.ts, the narration env-file form and the publisher CLI's two env-file lines, and each allowed cell is in use",
    { timeout: WALK_TIMEOUT },
    () => {
      for (const path of ['tools/publisher/env.ts', 'tools/narration/cli.ts', PUBLISHER_CLI]) {
        expect(realRead(path), `precondition: ${path} was read`).toBe(true)
      }
      expect
        .soft(
          real.scan.findings.filter((finding) => / s2-/.test(finding)),
          '(g1) no S2 finding',
        )
        .toEqual([])
      expect
        .soft(
          unusedAllowances(real.scan.hits, 's2'),
          '(g2) env.ts holds the name, the marker and the env-file form; narration cli.ts and publisher cli.ts the env-file form',
        )
        .toEqual([])
      expect
        .soft(
          realHits('tools/narration/cli.ts', 's2-env-file'),
          '(g3) cli.ts env-file lines :135, :136, :141',
        )
        .toEqual([135, 136, 141])
      expect
        .soft(
          real.scan.hits.filter(
            (hit) => hit.path === 'tools/narration/cli.ts' && hit.form !== 's2-env-file',
          ),
          '(g3) cli.ts holds no other form',
        )
        .toEqual([])
      expect
        .soft(
          isPinnedEnvFileForm(lineTextsOf(real.scan, PUBLISHER_CLI, 's2-env-file')),
          `(g4) ${PUBLISHER_CLI} env-file lines (${realHits(PUBLISHER_CLI, 's2-env-file').join(', ')}) are exactly the two pinned lines`,
        )
        .toBe(true)
      expect
        .soft(
          real.scan.hits
            .filter(
              (hit) =>
                hit.path === PUBLISHER_CLI &&
                hit.form.startsWith('s2-') &&
                hit.form !== 's2-env-file',
            )
            .map(findingOf),
          `(g4) ${PUBLISHER_CLI} holds no other S2 form`,
        )
        .toEqual([])
    },
  )

  it(
    "T14-86 FS2a cli.ts's env-file form is exactly the two pinned lines (L14)",
    { timeout: WALK_TIMEOUT },
    () => {
      expect(realRead(PUBLISHER_CLI), `precondition: ${PUBLISHER_CLI} was read`).toBe(true)
      expect(
        realHits(PUBLISHER_CLI, 's2-env-file').length,
        `precondition: ${PUBLISHER_CLI} gives an s2-env-file hit`,
      ).toBeGreaterThan(0)
      // The samples start from a small cli.ts of their own that holds the two pinned lines, so g1
      // reads the compare alone and a plant in the real file reaches g2.
      const base = [
        "import { loadEnvFile, readStorageCredentials } from './env'",
        'export async function runCli(deps: { loadEnv: () => unknown; env: object }) {',
        '  deps.loadEnv()',
        '  return readStorageCredentials(deps.env)',
        '}',
        'export const deps = {',
        '  loadEnv: loadEnvFile,',
        '}',
      ].join('\n')
      const inMemory = (text: string) =>
        lineTextsOf(scanFiles({ [PUBLISHER_CLI]: text }), PUBLISHER_CLI, 's2-env-file')
      expect(
        isPinnedEnvFileForm(inMemory(base)),
        'precondition: a cli.ts holding the two pinned lines passes the compare in memory',
      ).toBe(true)
      const samples: readonly (readonly [string, string])[] = [
        [
          'a third loadEnvFile() line',
          base.replace('  deps.loadEnv()', '  deps.loadEnv()\n  loadEnvFile()'),
        ],
        [
          'the reference moved into runCli as a call',
          base
            .replace('  deps.loadEnv()', '  loadEnvFile()')
            .replace('loadEnv: loadEnvFile,', 'loadEnv: () => undefined,'),
        ],
        [
          'an ENV_FILE import',
          base.replace(
            "import { loadEnvFile, readStorageCredentials } from './env'",
            "import { ENV_FILE, loadEnvFile, readStorageCredentials } from './env'",
          ),
        ],
        [
          "a '.env.local' literal",
          base.replace('  deps.loadEnv()', "  deps.loadEnv()\n  const local = '.env.local'"),
        ],
      ]
      for (const [id, text] of samples) {
        expect(text, `precondition: the sample "${id}" differs from the base`).not.toBe(base)
        expect
          .soft(isPinnedEnvFileForm(inMemory(text)), `(g1) ${id} fails the g4 compare`)
          .toBe(false)
      }
      expect
        .soft(
          isPinnedEnvFileForm(lineTextsOf(real.scan, PUBLISHER_CLI, 's2-env-file')),
          `(g2) the real file's env-file lines (${realHits(PUBLISHER_CLI, 's2-env-file').join(', ')}) equal the pinned texts`,
        )
        .toBe(true)
    },
  )

  it('T13-FS2b the key name, case-insensitive, in every read form, comments and YAML included', () => {
    expectSamples('g1', NAME_SAMPLES)
  })

  it("T13-FS2c the key's value marker in literals, cooked escapes and decoded regex literals", () => {
    expectSamples('g1', MARKER_SAMPLES)
  })

  it(
    'T13-FS2d env-file reads: literals, loadEnvFile, --env-file and dotenv specifiers; comments and near misses clean',
    { timeout: WALK_TIMEOUT },
    () => {
      expectSamples('g1', ENV_FILE_SAMPLES)
      const nearMisses: readonly (readonly [string, number])[] = [
        ['scripts/check-build.ts', 8],
        ['scripts/check-build.ts', 168],
        ['scripts/check-build.ts', 169],
        ['src/config/launch.ts', 16],
        ['src/config/site-url.ts', 6],
      ]
      for (const [path, line] of nearMisses) {
        const text = readFileSync(join(ROOT, path), 'utf8').split('\n')[line - 1] ?? ''
        expect(text.includes('.env'), `precondition: ${path}:${line} holds .env text`).toBe(true)
        expect(realRead(path), `precondition: ${path} was read`).toBe(true)
        expect
          .soft(realHits(path, 's2-env-file').includes(line), `(g2) ${path}:${line} is clean`)
          .toBe(false)
      }
    },
  )

  it('T13-FS2e the YAML secret forms in workflow files; the three real workflows are clean', () => {
    expectSamples('g1', YAML_SAMPLES)
    for (const name of ['ci.yml', 'keep-alive.yml', 'live-check.yml']) {
      const path = `.github/workflows/${name}`
      expect(realRead(path), `precondition: ${path} was read`).toBe(true)
      expect.soft(realHits(path, 's2-yaml'), `(g2) ${path} holds no YAML secret form`).toEqual([])
    }
  })

  it('T13-FS2f documented limits: a name assembled at run time and computed env reads are not flagged', () => {
    expectSamples('limit', S2_LIMIT_SAMPLES)
  })
})

// ---- S3, Secret.reveal (FS3; A34) ----

describe('S3: Secret.reveal (FS3)', () => {
  it(
    'T13-FS3a real tree: reveal is used only in storage.ts, hook.ts and content-deleter.ts, each in use; the near misses are clean',
    { timeout: WALK_TIMEOUT },
    () => {
      for (const path of [
        'tools/publisher/env.ts',
        'src/ui/player/player.tsx',
        'src/ui/player/story-part.tsx',
      ]) {
        expect(realRead(path), `precondition: ${path} was read`).toBe(true)
      }
      expect
        .soft(
          real.scan.findings.filter((finding) => / s3-/.test(finding)),
          '(g1) no S3 finding',
        )
        .toEqual([])
      expect
        .soft(unusedAllowances(real.scan.hits, 's3'), '(g2) each allowed reveal file uses it')
        .toEqual([])
      for (const path of [
        'tools/publisher/env.ts',
        'src/ui/player/player.tsx',
        'src/ui/player/story-part.tsx',
      ]) {
        expect.soft(realHits(path, 's3-reveal'), `(g3) ${path} gives no S3 hit`).toEqual([])
      }
    },
  )

  it('T13-FS3b every reveal form: property, optional, call/bind/apply, element, destructuring, Reflect and Object helpers, every script kind', () => {
    expectSamples('g1', REVEAL_SAMPLES)
  })

  it('T13-FS3c near misses are not flagged', () => {
    expectSamples('g1', REVEAL_NEAR_MISSES)
  })

  it('T13-FS3d documented limits: a computed name and eval are not flagged', () => {
    expectSamples('limit', REVEAL_LIMITS)
  })

  it('T13-FS3e writes to the global fetch or its dispatcher are flagged in every form; calls, reads and other names are not', () => {
    expectSamples('g1', FETCH_SAMPLES)
    expectSamples('g2', FETCH_NEAR_MISSES)
    expectSamples('limit', FETCH_LIMITS)
  })
})

// ---- literal and import pins (FS4) ----

describe('literal and import pins (FS4)', () => {
  it(
    'T13-FS4a storage.ts holds exactly the four route literals and no other method; no console; imports pinned',
    { timeout: WALK_TIMEOUT },
    () => {
      const storage = realTree('tools/publisher/storage.ts')
      const layout = realTree('tools/publisher/storage-layout.ts')
      expect(storage, 'precondition: storage.ts parsed').toBeDefined()
      expect(layout, 'precondition: storage-layout.ts parsed').toBeDefined()
      if (storage === undefined || layout === undefined) return
      expect(
        routeLiterals(storage).length,
        'precondition: storage.ts holds route literals',
      ).toBeGreaterThan(0)
      expect
        .soft(routeLiterals(storage), '(g1) exactly the four pinned route literals')
        .toEqual([
          '/storage/v1/object/',
          '/storage/v1/object/authenticated/content/',
          '/storage/v1/object/authenticated/masters/',
          '/storage/v1/object/list/content',
        ])
      const methods = tokensOf(storage)
        .literals.filter(({ value }) =>
          ['DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS'].includes(value.toUpperCase()),
        )
        .map(({ value, line }) => `${value}:${line}`)
      expect.soft(methods, '(g2) no DELETE, PUT, PATCH, HEAD or OPTIONS literal').toEqual([])
      for (const [name, tree] of [
        ['storage.ts', storage],
        ['storage-layout.ts', layout],
      ] as const) {
        const consoles = tokensOf(tree).identifiers.filter(({ value }) => value === 'console')
        expect
          .soft(
            consoles.map(({ line }) => line),
            `(g3) no console in ${name}`,
          )
          .toEqual([])
      }
      const builtins = new Set(builtinModules)
      const storageSpecs = tokensOf(storage).specifiers.map(({ value }) => value)
      const layoutSpecs = tokensOf(layout).specifiers.map(({ value }) => value)
      expect
        .soft(
          storageSpecs.filter(
            (spec) =>
              !['zod', './env', './http', './storage-layout'].includes(spec) &&
              !spec.startsWith('../../src/core/'),
          ),
          '(g4) storage.ts imports only zod, ./env, ./http, ./storage-layout and src/core',
        )
        .toEqual([])
      expect
        .soft(
          layoutSpecs.filter((spec) => !spec.startsWith('../../src/core/')),
          '(g4) storage-layout.ts imports only src/core',
        )
        .toEqual([])
      expect
        .soft(
          [...storageSpecs, ...layoutSpecs].filter(
            (spec) => spec.startsWith('node:') || builtins.has(spec),
          ),
          '(g4) no node: or bare builtin import in either',
        )
        .toEqual([])
    },
  )

  it(
    'T13-FS4b the stub imports only node: modules and ./storage-layout, and never asks the fence for an answer',
    { timeout: WALK_TIMEOUT },
    () => {
      const stub = realTree('tools/publisher/storage-stub.ts')
      expect(stub, 'precondition: the stub parsed').toBeDefined()
      if (stub === undefined) return
      const tokens = tokensOf(stub)
      expect(tokens.specifiers.length, 'precondition: the stub has imports').toBeGreaterThan(0)
      expect
        .soft(
          tokens.specifiers
            .map(({ value }) => value)
            .filter((spec) => !spec.startsWith('node:') && spec !== './storage-layout'),
          '(g1) only node: modules and ./storage-layout',
        )
        .toEqual([])
      expect
        .soft(
          asksTheFence(tokens),
          '(g2) no targetOf, pointerTarget, classOfPath or contentReadTarget',
        )
        .toEqual([])
    },
  )

  it(
    'T13-FS4c content-deleter.ts holds one DELETE literal, one route head, masters only in PROTECTED_BUCKETS, and imports only pure helpers from ./storage',
    { timeout: WALK_TIMEOUT },
    () => {
      const deleter = realTree('tools/publisher/content-deleter.ts')
      expect(deleter, 'precondition: content-deleter.ts parsed').toBeDefined()
      if (deleter === undefined) return
      const tokens = tokensOf(deleter)
      const exact = tokens.exactLiterals
      const deletes = exact.filter(({ value }) => value.toUpperCase() === 'DELETE')
      expect(deletes.length, 'precondition: a DELETE literal exists').toBeGreaterThan(0)
      expect.soft(deletes.length, '(g1) exactly one DELETE literal').toBe(1)
      expect
        .soft(routeLiterals(deleter), '(g2) the route head only')
        .toEqual(['/storage/v1/object/'])
      const masters: ts.Node[] = []
      const collect = (node: ts.Node): void => {
        if (isTextLiteral(node) && node.text === 'masters') masters.push(node)
        ts.forEachChild(node, collect)
      }
      collect(deleter)
      expect.soft(masters.length, "(g3) the literal 'masters' appears exactly once").toBe(1)
      let owner: ts.Node | undefined = masters[0]?.parent
      while (
        owner !== undefined &&
        (ts.isArrayLiteralExpression(owner) ||
          ts.isAsExpression(owner) ||
          ts.isSatisfiesExpression(owner) ||
          ts.isParenthesizedExpression(owner))
      ) {
        owner = owner.parent
      }
      expect
        .soft(
          masters[0] !== undefined &&
            ts.isArrayLiteralExpression(masters[0].parent) &&
            owner !== undefined &&
            ts.isVariableDeclaration(owner) &&
            ts.isIdentifier(owner.name) &&
            owner.name.text === 'PROTECTED_BUCKETS',
          '(g3) as the element of PROTECTED_BUCKETS',
        )
        .toBe(true)
      const files = repoFilesOf(real.scan.walk)
      const values: string[] = []
      const types: string[] = []
      const other: string[] = []
      const visit = (node: ts.Node): void => {
        const spec =
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          isTextLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : ts.isCallExpression(node) &&
                node.arguments[0] &&
                isTextLiteral(node.arguments[0]) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                  (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
              ? node.arguments[0].text
              : undefined
        const resolved =
          spec === undefined
            ? undefined
            : resolveFrom('tools/publisher/content-deleter.ts', spec, files)
        if (
          resolved !== undefined &&
          'file' in resolved &&
          resolved.file === 'tools/publisher/storage.ts'
        ) {
          const clause = ts.isImportDeclaration(node) ? node.importClause : undefined
          const named = clause?.namedBindings
          if (
            clause === undefined ||
            clause.name !== undefined ||
            named === undefined ||
            !ts.isNamedImports(named)
          ) {
            other.push(
              `line ${deleter.getLineAndCharacterOfPosition(node.getStart(deleter)).line + 1}`,
            )
          } else {
            for (const element of named.elements) {
              const name = (element.propertyName ?? element.name).text
              if (clause.isTypeOnly || element.isTypeOnly) types.push(name)
              else values.push(name)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(deleter)
      expect(
        values.length + types.length + other.length,
        'precondition: the deleter imports from ./storage',
      ).toBeGreaterThan(0)
      const pure = [
        'DEFAULT_TIMEOUT_MS',
        'StorageRefusedError',
        'classifyFailure',
        'isFolderPrefix',
        'repeatsSecretRun',
      ]
      expect
        .soft(
          values.filter((name) => !pure.includes(name)),
          '(g4) value imports are pure helpers only',
        )
        .toEqual([])
      expect
        .soft(
          types.filter((name) => name !== 'StorageFailure'),
          '(g4) the type import is StorageFailure only',
        )
        .toEqual([])
      expect
        .soft(
          other,
          '(g4) no namespace, default, side-effect, re-export, import() or require of ./storage',
        )
        .toEqual([])
      expect
        .soft(
          [...values, ...types].includes('createStorageClient'),
          '(g4) never createStorageClient',
        )
        .toBe(false)
    },
  )

  it(
    "T14-83 FS4d real tree: each new module's imports, network names and globals are pinned (A26, CRIT-4, CRIT-5, TP-3)",
    { timeout: WALK_TIMEOUT },
    async () => {
      const envExports = await exportNames('env.ts')
      expect(envExports, 'precondition: env.ts exports the four names the CLI takes').toEqual(
        expect.arrayContaining([...CLI_ENV_NAMES]),
      )
      for (const path of FS4D_ROWS.keys()) {
        expect(
          real.scan.tokens(path)?.specifiers.length ?? 0,
          `precondition: ${path} parsed with at least one specifier`,
        ).toBeGreaterThan(0)
      }
      const found = fs4dFindings(real.scan, envExports)
      expect
        .soft(
          found.g0,
          '(g0) every non-test script under tools/publisher/ is a Step 13 file or has a row',
        )
        .toEqual([])
      expect.soft(found.g1, "(g1) each module's specifiers lie within its row").toEqual([])
      expect
        .soft(found.g2, '(g2) zod is the only bare package, held by story-checks.ts only')
        .toEqual([])
      expect
        .soft(
          found.g3,
          '(g3) no ./storage-stub; ./content-deleter, ./storage, ./env, ./hook and ./verify from cli.ts only; cli.ts names only loadEnvFile, readDeployHookUrl, readSiteUrl and readStorageCredentials of env.ts',
        )
        .toEqual([])
      expect
        .soft(found.g4, '(g4) no network module, with or without node:, in any import form')
        .toEqual([])
      expect
        .soft(found.g5, '(g5) no fetch, WebSocket, EventSource, XMLHttpRequest or Request')
        .toEqual([])
      expect.soft(found.g6, '(g6) no console or process outside cli.ts').toEqual([])
      expect.soft(found.g7, '(g7) no literal starting panchatantra@').toEqual([])
      expect
        .soft(
          found.g8,
          '(g8) cli.ts names captureRunContext on its import and the pinned entry line',
        )
        .toEqual([])
    },
  )

  it(
    'T14-84 FS4d negative samples through the same predicates (L14, CRIT-5; catalogue lint classes 1-8, 10-13)',
    { timeout: WALK_TIMEOUT },
    async () => {
      const envExports = await exportNames('env.ts')
      const flat = (found: Fs4dFindings) => FS4D_GROUPS.flatMap((group) => found[group])
      expect(
        flat(fs4dFindings(real.scan, envExports)),
        'precondition: the real tree passes FS4d (T14-83)',
      ).toEqual([])
      const cliText = readFileSync(join(HERE, 'cli.ts'), 'utf8')
      for (const [id, files] of [
        [
          'a clean stage.ts',
          {
            'tools/publisher/stage.ts': "import { x } from './storage-layout'\nexport const y = x",
          },
        ],
        ['the real cli.ts alone', { [PUBLISHER_CLI]: cliText }],
      ] as const) {
        expect(
          flat(fs4dFindings(scanFiles(files), envExports)),
          `precondition: ${id} in memory gives no finding`,
        ).toEqual([])
      }
      const runContextChanged = cliText
        .replace(
          'const runContext = captureRunContext(process.env, process.platform)',
          'const started = Date.now()',
        )
        .replace('    runContext,\n', '    runContext: process.env,\n')
      expect(runContextChanged, 'precondition: the run-context sample was built').not.toBe(cliText)
      // g3's cli.ts samples add one name to a cli.ts that already names the four it may, so each is
      // flagged for the added name.
      const cliBase =
        "import { loadEnvFile, readStorageCredentials } from './env'\nimport { readDeployHookUrl, readSiteUrl } from './env'\nexport const named = [loadEnvFile, readStorageCredentials, readDeployHookUrl, readSiteUrl]\n"
      expect(
        fs4dFindings(scanFiles({ [PUBLISHER_CLI]: cliBase }), envExports).g3,
        'precondition: a cli.ts naming only loadEnvFile, readDeployHookUrl, readSiteUrl and readStorageCredentials gives no g3 finding',
      ).toEqual([])
      const stage = 'tools/publisher/stage.ts'
      const report = 'tools/publisher/report.ts'
      const state = 'tools/publisher/catalogue-state.ts'
      const one = (path: string, text: string): Readonly<Record<string, string>> => ({
        [path]: text,
      })
      const flagged: readonly (readonly [
        string,
        Readonly<Record<string, string>>,
        readonly Fs4dGroup[],
      ])[] = [
        // Network globals (g5): catalogue lint classes 1-8 and the class 10 neighbours.
        ['c1 fetch() in stage.ts', one(stage, "export const f = () => fetch('https://x')"), ['g5']],
        [
          'c2 globalThis.fetch in report.ts',
          one(report, 'export const f = (u: string) => globalThis.fetch(u)'),
          ['g5'],
        ],
        [
          'c3 a computed literal key',
          one(report, "export const f = (u: string) => globalThis['fetch'](u)"),
          ['g5'],
        ],
        [
          'c4 a computed template key',
          one(report, 'export const f = (u: string) => globalThis[`fetch`](u)'),
          ['g5'],
        ],
        [
          'c5 optional chaining',
          one(report, 'export const f = (u: string) => globalThis?.fetch(u)'),
          ['g5'],
        ],
        [
          'c6 an alias',
          one(report, 'const g = globalThis\nexport const f = (u: string) => g.fetch(u)'),
          ['g5'],
        ],
        ['c7 destructuring', one(report, 'const { fetch: f } = globalThis\nexport { f }'), ['g5']],
        [
          'c7 computed destructuring',
          one(report, "const { ['fetch']: f } = globalThis\nexport { f }"),
          ['g5'],
        ],
        [
          'c8 Reflect.get with a literal name',
          one(report, "export const f = Reflect.get(globalThis, 'fetch')"),
          ['g5'],
        ],
        ['c10 WebSocket', one(stage, 'export const s = (u: string) => new WebSocket(u)'), ['g5']],
        [
          'c10 EventSource',
          one(stage, 'export const s = (u: string) => new EventSource(u)'),
          ['g5'],
        ],
        ['c10 XMLHttpRequest', one(stage, 'export const s = () => new XMLHttpRequest()'), ['g5']],
        ['c10 Request', one(stage, 'export const s = (u: string) => new Request(u)'), ['g5']],
        // Network modules (g4): each of the ten, every import form the tokeniser records.
        [
          'node:https in catalogue-state.ts',
          one(state, "import { request } from 'node:https'\nexport const r = request"),
          ['g4'],
        ],
        [
          'https without node:',
          one(state, "import https from 'https'\nexport const h = https"),
          ['g4', 'g2'],
        ],
        [
          'require of node:net',
          one(state, "export const n: unknown = require('node:net')"),
          ['g4'],
        ],
        ['import() of node:tls', one(state, "export const t = () => import('node:tls')"), ['g4']],
        [
          'a type-only node:http import',
          one(state, "import type { Agent } from 'node:http'\nexport type A = Agent"),
          ['g4'],
        ],
        [
          'export * from node:child_process',
          one(state, "export * from 'node:child_process'"),
          ['g4'],
        ],
        [
          'a side-effect node:worker_threads import',
          one(state, "import 'node:worker_threads'"),
          ['g4'],
        ],
        ['node:http2', one(state, "import 'node:http2'"), ['g4']],
        ['dgram', one(state, "import 'dgram'"), ['g4', 'g2']],
        ['cluster', one(state, "import 'cluster'"), ['g4', 'g2']],
        ['node:vm', one(state, "import vm from 'node:vm'\nexport const v = vm"), ['g4']],
        ['NODE:HTTPS in upper case', one(state, "import 'NODE:HTTPS'"), ['g4', 'g2']],
        // Bare packages (g2) and rows (g1).
        [
          'undici in local-files.ts',
          one('tools/publisher/local-files.ts', "import x from 'undici'\nexport const u = x"),
          ['g2', 'g1'],
        ],
        [
          'zod in args.ts',
          one('tools/publisher/args.ts', "import { z } from 'zod'\nexport const s = z.string()"),
          ['g2', 'g1'],
        ],
        [
          'media-check.ts importing ./local-files',
          one(
            'tools/publisher/media-check.ts',
            "import { readLocalFile } from './local-files'\nexport const r = readLocalFile",
          ),
          ['g1'],
        ],
        [
          'stage-testkit.ts importing scripts/testing',
          one(
            'tools/publisher/stage-testkit.ts',
            "import { x } from '../../scripts/testing/staging-catalogue'\nexport const y = x",
          ),
          ['g1'],
        ],
        [
          'a src/core specifier whose .. leaves src/core',
          one(
            stage,
            "import { x } from '../../src/core/../../tools/publisher/hook'\nexport const y = x",
          ),
          ['g1', 'g3'],
        ],
        // Imports of fenced or hook modules (g3), path forms included.
        ['./hook in stage.ts', one(stage, "import './hook'"), ['g3', 'g1']],
        ['./Hook.js in stage.ts', one(stage, "import './Hook.js'"), ['g3']],
        [
          '../publisher/verify in stage.ts',
          one(stage, "import { verify } from '../publisher/verify'\nexport const v = verify"),
          ['g3'],
        ],
        [
          './content-deleter.ts re-exported',
          one(stage, "export * from './content-deleter.ts'"),
          ['g3'],
        ],
        [
          './storage-stub in story-checks.ts',
          one('tools/publisher/story-checks.ts', "import './storage-stub'"),
          ['g3', 'g1'],
        ],
        [
          './storage outside the CLI',
          one(
            stage,
            "import { createStorageClient } from './storage'\nexport const c = createStorageClient",
          ),
          ['g3'],
        ],
        [
          './env outside the CLI',
          one(report, "import { loadEnvFile } from './env'\nexport const l = loadEnvFile"),
          ['g3'],
        ],
        [
          'readSecretKey in cli.ts',
          one(
            PUBLISHER_CLI,
            `${cliBase}import { readSecretKey } from './env'\nexport const r = readSecretKey`,
          ),
          ['g3'],
        ],
        [
          'checkPublisherEnv in cli.ts',
          one(PUBLISHER_CLI, `${cliBase}export const c = (env: object) => checkPublisherEnv(env)`),
          ['g3'],
        ],
        [
          'an env.ts name as a computed key in cli.ts',
          one(
            PUBLISHER_CLI,
            `${cliBase}import * as env from './env'\nexport const r = env['readSecretKey']`,
          ),
          ['g3'],
        ],
        // console and process outside the CLI (g6).
        [
          'console.error in stage.ts',
          one(stage, 'export const e = (x: string) => console.error(x)'),
          ['g6'],
        ],
        ['process.env in stage.ts', one(stage, 'export const v = process.env.X'), ['g6']],
        [
          'process as a computed literal key',
          one(stage, "export const p: unknown = globalThis['process']"),
          ['g6'],
        ],
        [
          'console through Reflect.get',
          one(stage, "export const c: unknown = Reflect.get(globalThis, 'console')"),
          ['g6'],
        ],
        // A rule-set literal (g7).
        [
          'a rule-set literal in story-checks.ts',
          one('tools/publisher/story-checks.ts', "export const ref = 'panchatantra@3.0.0'"),
          ['g7'],
        ],
        [
          'a rule-set template head',
          one(
            'tools/publisher/story-checks.ts',
            'export const ref = (v: string) => `panchatantra@${v}`',
          ),
          ['g7'],
        ],
        // A script without a row (g0), every script extension (catalogue lint class 11).
        ...['stage.mts', 'extra.ts', 'x.cts', 'x.tsx', 'x.js', 'x.jsx', 'x.mjs', 'x.cjs'].map(
          (name) =>
            [
              `tools/publisher/${name} has no row`,
              one(`tools/publisher/${name}`, 'export const x = 1'),
              ['g0'],
            ] as const,
        ),
        // The CLI's run-context line (g8).
        [
          'runContext: process.env in the entry block',
          one(PUBLISHER_CLI, runContextChanged),
          ['g8'],
        ],
      ]
      for (const [id, files, groups] of flagged) {
        const scan = scanFiles(files)
        const found = fs4dFindings(scan, envExports)
        for (const group of groups) {
          expect.soft(found[group].length, `(g1) ${id} is flagged by ${group}`).toBeGreaterThan(0)
        }
        expect.soft(scan.walk.findings, `(g1) ${id} walks cleanly`).toEqual([])
      }
      const notFlagged: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
        // Documented limits (L14; catalogue lint class 13).
        [
          'a name assembled at run time',
          one(stage, "export const f = (globalThis as Record<string, unknown>)['fe' + 'tch']"),
        ],
        [
          'import() of a variable',
          one(stage, 'export const load = (name: string) => import(name)'),
        ],
        [
          'a fetch inside a src/core module (FS4d is one hop)',
          {
            [stage]: "import { get } from '../../src/core/net'\nexport const y = get",
            'src/core/net.ts': 'export const get = (u: string) => fetch(u)',
          },
        ],
        // Near misses.
        [
          'names that hold a network name',
          one(
            stage,
            'export const fetchImpl = 1\nexport const prefetch = 2\nexport type R = RequestInit',
          ),
        ],
        [
          'names that hold console or process',
          one(stage, "export const processed = 1\nexport const consoleLine = 'console line'"),
        ],
        [
          './storage-layout is not ./storage',
          one(
            stage,
            "import { classOfPath } from './storage-layout'\nexport const c = classOfPath",
          ),
        ],
        [
          'the rule-set ref read from the rule set',
          one(
            'tools/publisher/story-checks.ts',
            "import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'\nexport const ref = PANCHATANTRA_RULESET.ref\nexport const name = 'panchatantra'",
          ),
        ],
      ]
      for (const [id, files] of notFlagged) {
        const scan = scanFiles(files)
        expect.soft(flat(fs4dFindings(scan, envExports)), `(g2) ${id} is not flagged`).toEqual([])
        expect.soft(scan.walk.findings, `(g2) ${id} walks cleanly`).toEqual([])
      }
    },
  )

  it(
    'T15A-63 FS4d negative samples for the Step 15a modules through the same predicates (D15-20, L21)',
    { timeout: WALK_TIMEOUT },
    async () => {
      const envExports = await exportNames('env.ts')
      const flat = (found: Fs4dFindings) => FS4D_GROUPS.flatMap((group) => found[group])
      expect(
        flat(fs4dFindings(real.scan, envExports)),
        'precondition: the real tree passes FS4d (T14-83)',
      ).toEqual([])
      const approve = 'tools/publisher/approve.ts'
      const answers = 'tools/publisher/answers.ts'
      const publish = 'tools/publisher/publish.ts'
      const remote = 'tools/publisher/remote-checks.ts'
      const runKit = 'tools/publisher/run-kit.ts'
      const one = (path: string, text: string): Readonly<Record<string, string>> => ({
        [path]: text,
      })
      // A clean cli.ts: the pinned run-context lines and exactly the four env.ts names it may, so a
      // sample adds one import or one name.
      const cliClean =
        "import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'\nimport { loadEnvFile, readStorageCredentials } from './env'\nimport { readDeployHookUrl, readSiteUrl } from './env'\nexport const named = [RUN_CONTEXT_NAMES, parseArgs, loadEnvFile, readStorageCredentials, readDeployHookUrl, readSiteUrl]\nconst runContext = captureRunContext(process.env, process.platform)\nexport { runContext }\n"
      const clean: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
        ['cli.ts', one(PUBLISHER_CLI, cliClean)],
        ['approve.ts', one(approve, "import { x } from './answers'\nexport const y = x")],
        [
          'answers.ts',
          one(
            answers,
            "import { isLocaleCode } from '../../src/core/locales'\nexport const y = isLocaleCode",
          ),
        ],
        ['publish.ts', one(publish, "import { x } from './run-kit'\nexport const y = x")],
        ['remote-checks.ts', one(remote, "import type { R } from './port'\nexport type Y = R")],
        ['run-kit.ts', one(runKit, "import { x } from './report'\nexport const y = x")],
      ]
      for (const [id, files] of clean) {
        expect(
          flat(fs4dFindings(scanFiles(files), envExports)),
          `precondition: a clean ${id} in memory gives no finding`,
        ).toEqual([])
      }
      const flagged: readonly (readonly [string, Readonly<Record<string, string>>, Fs4dGroup])[] = [
        [
          'publish.ts importing ./hook',
          one(
            publish,
            "import { triggerDeployHook } from './hook'\nexport const h = triggerDeployHook",
          ),
          'g3',
        ],
        [
          'approve.ts importing ./storage',
          one(
            approve,
            "import { createStorageClient } from './storage'\nexport const c = createStorageClient",
          ),
          'g3',
        ],
        [
          'approve.ts importing ./env',
          one(approve, "import { readSecretKey } from './env'\nexport const r = readSecretKey"),
          'g3',
        ],
        [
          'answers.ts importing node:fs',
          one(answers, "import { readFileSync } from 'node:fs'\nexport const r = readFileSync"),
          'g1',
        ],
        [
          'remote-checks.ts importing ./catalogue-state',
          one(
            remote,
            "import { readCatalogueState } from './catalogue-state'\nexport const r = readCatalogueState",
          ),
          'g1',
        ],
        [
          'run-kit.ts importing src/core (its row has none)',
          one(
            runKit,
            "import { sha256Hex } from '../../src/core/hashing'\nexport const h = sha256Hex",
          ),
          'g1',
        ],
        ['publish.ts naming fetch', one(publish, 'export const f = (u: string) => fetch(u)'), 'g5'],
        ['approve.ts naming process', one(approve, 'export const a = () => process.argv'), 'g6'],
        [
          'answers.ts requiring node:net',
          one(answers, "export const n: unknown = require('node:net')"),
          'g4',
        ],
        [
          'approve.ts importing node:readline (only the answers.ts row has it)',
          one(
            approve,
            "import { createInterface } from 'node:readline'\nexport const c = createInterface",
          ),
          'g1',
        ],
        [
          'cli.ts naming Secret',
          one(
            PUBLISHER_CLI,
            `${cliClean}import type { Secret } from './env'\nexport type S = Secret`,
          ),
          'g3',
        ],
        [
          'cli.ts naming readSecretKey',
          one(
            PUBLISHER_CLI,
            `${cliClean}import { readSecretKey } from './env'\nexport const r = readSecretKey`,
          ),
          'g3',
        ],
      ]
      for (const [id, files, group] of flagged) {
        const scan = scanFiles(files)
        expect
          .soft(fs4dFindings(scan, envExports)[group].length, `(g1) ${id} is flagged by ${group}`)
          .toBeGreaterThan(0)
        expect.soft(scan.walk.findings, `(g1) ${id} walks cleanly`).toEqual([])
      }
      const notFlagged: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
        [
          'cli.ts importing ./hook and ./verify',
          one(
            PUBLISHER_CLI,
            `${cliClean}import { triggerDeployHook } from './hook'\nimport { verifyPublish } from './verify'\nexport const t = [triggerDeployHook, verifyPublish]`,
          ),
        ],
        [
          'answers.ts importing node:readline',
          one(
            answers,
            "import { createInterface } from 'node:readline'\nexport const c = createInterface",
          ),
        ],
      ]
      for (const [id, files] of notFlagged) {
        const scan = scanFiles(files)
        expect.soft(flat(fs4dFindings(scan, envExports)), `(g2) ${id} is not flagged`).toEqual([])
        expect.soft(scan.walk.findings, `(g2) ${id} walks cleanly`).toEqual([])
      }
    },
  )

  it(
    'T15B-56 FS4d negative samples for takedown.ts and verify-command.ts through the same predicates (D15B-25, CRIT-12, L26)',
    { timeout: WALK_TIMEOUT },
    async () => {
      const envExports = await exportNames('env.ts')
      const flat = (found: Fs4dFindings) => FS4D_GROUPS.flatMap((group) => found[group])
      expect(
        flat(fs4dFindings(real.scan, envExports)),
        'precondition: the real tree passes FS4d (T14-83)',
      ).toEqual([])
      const takedown = 'tools/publisher/takedown.ts'
      const verifyCommand = 'tools/publisher/verify-command.ts'
      const publish = 'tools/publisher/publish.ts'
      const one = (path: string, text: string): Readonly<Record<string, string>> => ({
        [path]: text,
      })
      // A clean cli.ts: the pinned run-context lines, exactly the four env.ts names it may, and the
      // three specifiers Step 15b adds (D15B-14, D15B-19, D15B-36).
      const cliSample =
        "import { RUN_CONTEXT_NAMES, captureRunContext, parseArgs } from './args'\nimport { loadEnvFile, readStorageCredentials } from './env'\nimport { readDeployHookUrl, readSiteUrl } from './env'\nimport { createContentDeleter } from './content-deleter'\nimport { runVerify } from './verify-command'\nimport { realpathSync } from 'node:fs'\nexport const named = [RUN_CONTEXT_NAMES, parseArgs, loadEnvFile, readStorageCredentials, readDeployHookUrl, readSiteUrl, createContentDeleter, runVerify, realpathSync]\nconst runContext = captureRunContext(process.env, process.platform)\nexport { runContext }\n"
      const clean: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
        [
          'takedown.ts holding exactly its row and a src/core import',
          one(
            takedown,
            "import { hasUnstorableSegment } from './args'\nimport { readCatalogueState } from './catalogue-state'\nimport { readLocalFile } from './local-files'\nimport type { StorageReader } from './port'\nimport { readCheckedPackage } from './remote-checks'\nimport { isLocalRealPath } from './report'\nimport { failureCode } from './run-kit'\nimport { classOfPath } from './storage-layout'\nimport { join } from 'node:path'\nimport { sha256Hex } from '../../src/core/hashing'\nexport type R = StorageReader\nexport const t = [hasUnstorableSegment, readCatalogueState, readLocalFile, readCheckedPackage, isLocalRealPath, failureCode, classOfPath, join, sha256Hex]",
          ),
        ],
        [
          'verify-command.ts holding exactly its row',
          one(
            verifyCommand,
            "import { readCatalogueState } from './catalogue-state'\nimport type { VerifySite } from './port'\nimport { readCheckedPackage } from './remote-checks'\nimport { formatVerifyExpected } from './report'\nimport { failureCode } from './run-kit'\nimport { classOfPath } from './storage-layout'\nexport type S = VerifySite\nexport const v = [readCatalogueState, readCheckedPackage, formatVerifyExpected, failureCode, classOfPath]",
          ),
        ],
        ['the cli.ts sample', one(PUBLISHER_CLI, cliSample)],
      ]
      for (const [id, files] of clean) {
        expect(
          flat(fs4dFindings(scanFiles(files), envExports)),
          `precondition: ${id} in memory gives no finding`,
        ).toEqual([])
      }
      const flagged: readonly (readonly [
        string,
        Readonly<Record<string, string>>,
        readonly Fs4dGroup[],
      ])[] = [
        [
          'takedown.ts importing rmSync from node:fs',
          one(takedown, "import { rmSync } from 'node:fs'\nexport const r = rmSync"),
          ['g1'],
        ],
        [
          'takedown.ts importing ./content-deleter',
          one(
            takedown,
            "import { createContentDeleter } from './content-deleter'\nexport const c = createContentDeleter",
          ),
          ['g3', 'g1'],
        ],
        [
          'takedown.ts importing ./storage',
          one(
            takedown,
            "import { createStorageClient } from './storage'\nexport const c = createStorageClient",
          ),
          ['g3', 'g1'],
        ],
        [
          'takedown.ts naming fetch',
          one(takedown, 'export const f = (u: string) => fetch(u)'),
          ['g5'],
        ],
        [
          'takedown.ts naming process',
          one(takedown, 'export const a = () => process.argv'),
          ['g6'],
        ],
        [
          'verify-command.ts importing ./verify',
          one(verifyCommand, "import { checkRange } from './verify'\nexport const c = checkRange"),
          ['g3', 'g1'],
        ],
        [
          'verify-command.ts requiring node:https',
          one(verifyCommand, "export const h: unknown = require('node:https')"),
          ['g4', 'g1'],
        ],
        [
          'verify-command.ts naming Request',
          one(verifyCommand, 'export const r = (u: string) => new Request(u)'),
          ['g5'],
        ],
        [
          'verify-command.ts naming console',
          one(verifyCommand, 'export const e = (x: string) => console.error(x)'),
          ['g6'],
        ],
        [
          'verify-command.ts holding the literal panchatantra@1',
          one(verifyCommand, "export const ref = 'panchatantra@1'"),
          ['g7'],
        ],
        [
          'publish.ts importing ./content-deleter',
          one(
            publish,
            "import { createContentDeleter } from './content-deleter'\nexport const c = createContentDeleter",
          ),
          ['g3', 'g1'],
        ],
        [
          'publish.ts importing ./verify-command',
          one(publish, "import { runVerify } from './verify-command'\nexport const v = runVerify"),
          ['g1'],
        ],
      ]
      for (const [id, files, groups] of flagged) {
        const scan = scanFiles(files)
        const found = fs4dFindings(scan, envExports)
        for (const group of groups) {
          expect.soft(found[group].length, `(g1) ${id} is flagged by ${group}`).toBeGreaterThan(0)
        }
        expect.soft(scan.walk.findings, `(g1) ${id} walks cleanly`).toEqual([])
      }
      const cliSamplePath = PUBLISHER_CLI
      const notFlagged: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
        ['the cli.ts sample', one(cliSamplePath, cliSample)],
        [
          'takedown.ts importing node:path',
          one(takedown, "import { join } from 'node:path'\nexport const j = join"),
        ],
      ]
      for (const [id, files] of notFlagged) {
        const scan = scanFiles(files)
        expect.soft(flat(fs4dFindings(scan, envExports)), `(g2) ${id} is not flagged`).toEqual([])
        expect.soft(scan.walk.findings, `(g2) ${id} walks cleanly`).toEqual([])
      }
    },
  )

  it(
    'T14-85 FS4b the stub-asks-the-fence predicate flags contentReadTarget (CRIT-6)',
    { timeout: WALK_TIMEOUT },
    () => {
      const stub = realTree('tools/publisher/storage-stub.ts')
      expect(stub, 'precondition: the stub parsed').toBeDefined()
      if (stub === undefined) return
      expect(asksTheFence(tokensOf(stub)), 'precondition: the real stub passes FS4b g2').toEqual([])
      const path = 'tools/publisher/storage-stub.ts'
      const asks = (text: string): string[] | undefined => {
        const tokens = scanFiles({ [path]: text }).tokens(path)
        return tokens === null ? undefined : asksTheFence(tokens)
      }
      const layout = "import * as layout from './storage-layout'\n"
      const flagged: readonly (readonly [string, string])[] = [
        [
          'a named import and a call',
          "import { contentReadTarget } from './storage-layout'\nexport const t = contentReadTarget({ kind: 'pointer', mode: 'staging' })",
        ],
        [
          'a member call',
          `${layout}export const t = (ref: unknown) => layout.contentReadTarget(ref)`,
        ],
        [
          'optional chaining',
          `${layout}export const t = (ref: unknown) => layout?.contentReadTarget(ref)`,
        ],
        [
          'an alias',
          `${layout}const l = layout\nexport const t = (ref: unknown) => l.contentReadTarget(ref)`,
        ],
        ['destructuring', `${layout}const { contentReadTarget: read } = layout\nexport { read }`],
        ['targetOf', `${layout}export const t = (ref: unknown) => layout.targetOf(ref)`],
        ['pointerTarget', `${layout}export const t = () => layout.pointerTarget('staging')`],
        [
          'classOfPath',
          `${layout}export const t = (p: string) => layout.classOfPath('content', p)`,
        ],
      ]
      for (const [id, text] of flagged) {
        expect.soft(asks(text)?.length ?? 0, `(g1) ${id} is flagged`).toBeGreaterThan(0)
      }
      const notFlagged: readonly (readonly [string, string])[] = [
        ['the near miss contentReadTargets', 'export const contentReadTargets = 1'],
        // Documented limits of FS4b's identifier form (unchanged from Step 13): computed names.
        [
          'limit: a computed literal key',
          `${layout}export const t = (ref: unknown) => layout['contentReadTarget'](ref)`,
        ],
        [
          'limit: a computed template key',
          `${layout}export const t = (ref: unknown) => layout[\`contentReadTarget\`](ref)`,
        ],
        [
          'limit: Reflect.get with a literal name',
          `${layout}export const t: unknown = Reflect.get(layout, 'contentReadTarget')`,
        ],
      ]
      for (const [id, text] of notFlagged) {
        expect.soft(asks(text), `(g2) ${id} is not flagged`).toEqual([])
      }
    },
  )
})

// ---- finding format and the allow-list compare (FS5, FS6) ----

describe('findings and the allow-list compare (FS5, FS6)', () => {
  it(
    'T13-FS5 a finding is `path:line form-id` only, never the matched text',
    { timeout: WALK_TIMEOUT },
    () => {
      const sample = scanFiles({ 'scripts/x.ts': "const u = '/storage/v1/object/sign/' // Q7MARK" })
      expect
        .soft(sample.findings, '(g1) exactly the path, line and form')
        .toEqual(['scripts/x.ts:1 s1-route'])
      const SCAN_FINDING = /^[\w./-]+:\d+ [a-z0-9-]+$/
      const WALK_FINDING =
        /^(?:unknown-folder \S+|unknown-extension (?:[\w-]+|\(none\))|unreadable [\w./-]+|parse-error [\w./-]+|env-named-entry [\w./-]+|empty-walk)$/
      const scans = [
        real.scan,
        ...ALL_SAMPLES.flatMap((samples) =>
          samples.map(([, path, text]) => scanFiles({ [path]: text })),
        ),
        // Trees that give every kind of walker finding.
        scanFiles({
          'newdir/x.ts': 'export const x = 1',
          'src/x.xyz': 'x',
          'scripts/Makefile': 'x:',
          'scripts/a.ts': { error: 'EACCES' },
          'scripts/x.ts': 'const x = ;',
          'scripts/ok.ts': "export const u = '/storage/v1/object/move' // Q7MARK",
          'scripts/.envx/Q7MARK.ts': 'export const x = 1',
        }),
        scanFiles({}),
        // A repository root that gives every root walker finding (review fix SEC2-6).
        scanFiles({
          '../newroot/x.ts': 'export const x = 1',
          '../Q7MARK.mjs': 'export const x = 1',
          '../Makefile': 'x:',
          '../.envx/Q7MARK.ts': 'export const x = 1',
          '../README.md': { error: 'EACCES' },
          'scripts/ok.ts': 'export const ok = 1',
        }),
      ]
      expect(
        scans.reduce((count, scan) => count + scan.findings.length, 0),
        'precondition: the samples give findings',
      ).toBeGreaterThan(50)
      expect(
        scans.reduce((count, scan) => count + scan.walk.findings.length, 0),
        'precondition: the trees give walker findings of every kind',
      ).toBeGreaterThanOrEqual(7)
      for (const scan of scans) {
        for (const finding of scan.findings) {
          expect
            .soft(SCAN_FINDING.test(finding), `(g2) scan finding format: ${finding.slice(0, 120)}`)
            .toBe(true)
          expect.soft(finding.includes('Q7MARK'), '(g2) no matched text').toBe(false)
        }
        for (const finding of scan.walk.findings) {
          expect
            .soft(
              WALK_FINDING.test(finding),
              `(g3) walker finding format: ${finding.slice(0, 120)}`,
            )
            .toBe(true)
          expect
            .soft(
              finding.includes('Q7MARK') || finding.toLowerCase().includes('.env'),
              '(g3) no .env-named entry is named',
            )
            .toBe(false)
        }
      }
    },
  )

  it('T13-FS6 the allow-list compare normalises separators, then compares the exact path', () => {
    const route = "export const u = '/storage/v1/object/move'"
    const backslash = scanFiles({ 'tools\\publisher\\storage.ts': route })
    expect(backslash.reads, 'precondition: the backslash-keyed sample was read').toEqual([
      'tools\\publisher\\storage.ts',
    ])
    expect
      .soft(backslash.findings, '(g1) tools\\publisher\\storage.ts is storage.ts (allowed)')
      .toEqual([])
    expect
      .soft(
        scanFiles({ 'tools/publisher/STORAGE.ts': route }).findings,
        '(g2) STORAGE.ts is not storage.ts',
      )
      .toEqual(['tools/publisher/STORAGE.ts:1 s1-route'])
    expect
      .soft(
        scanFiles({ 'tools/publisher/storage.tsx': route }).findings,
        '(g2) storage.tsx is not storage.ts',
      )
      .toEqual(['tools/publisher/storage.tsx:1 s1-route'])
  })
})
