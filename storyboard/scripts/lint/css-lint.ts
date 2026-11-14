// CSS lint CLI (spec §6.7 RC-12, §10.2 lint; P1-1b, owner D5). `pnpm lint` runs it after ESLint:
// `eslint . && tsx scripts/lint/css-lint.ts`. With no arguments it lints every app/**/*.css and
// src/**/*.css; with arguments, only the files named (used for the seeded-violation proof). Prints
// `file:line:col rule message` for each finding and exits 1 on any finding or unreadable file.
// Node built-ins only; the rules are in ./css-rules.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declaredCustomProperties, lintCss, TOKENS_FILE, type Finding } from './css-rules'

/** The folders linted when no file is named, relative to the storyboard root. */
export const LINT_ROOTS: readonly string[] = ['app', 'src']

const toPosix = (path: string): string => path.split(sep).join('/')

/** Every *.css file under app/ and src/, as sorted root-relative paths with forward slashes. */
export function collectCssFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.css'))
        found.push(toPosix(relative(root, path)))
    }
  }
  for (const folder of LINT_ROOTS) walk(join(root, folder))
  return found.sort()
}

/** Root-relative with forward slashes when inside the root, else the absolute path. */
export function displayPath(root: string, absolute: string): string {
  const rel = relative(root, absolute)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? toPosix(rel) : toPosix(absolute)
}

export function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`
}

/**
 * Lints the named files (resolved against `cwd`), or every app/ and src/ stylesheet when none is
 * named, writes one line per finding, and returns the exit code: 1 on any finding or error.
 */
export function runCssLint(
  root: string,
  args: readonly string[],
  cwd: string,
  write: (line: string) => void,
): number {
  let tokens: Set<string>
  try {
    tokens = declaredCustomProperties(readFileSync(join(root, TOKENS_FILE), 'utf8'))
  } catch (error) {
    write(`css-lint: cannot read ${TOKENS_FILE} (${errorCode(error)})`)
    return 1
  }
  const files =
    args.length > 0
      ? args.map((arg) => displayPath(root, resolve(cwd, arg)))
      : collectCssFiles(root)
  let errors = 0
  const findings: Finding[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(isAbsolute(file) ? file : join(root, file), 'utf8')
    } catch (error) {
      write(`${file}: cannot read (${errorCode(error)})`)
      errors++
      continue
    }
    findings.push(...lintCss(text, { file, tokens }))
  }
  for (const finding of findings) write(formatFinding(finding))
  const withFindings = new Set(findings.map((finding) => finding.file)).size
  if (findings.length > 0) {
    write(
      `css-lint: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${withFindings} of ${files.length} file${files.length === 1 ? '' : 's'}`,
    )
  } else if (errors === 0) {
    write(`css-lint: ${files.length} file${files.length === 1 ? '' : 's'}, no findings`)
  }
  return findings.length > 0 || errors > 0 ? 1 : 0
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return 'unknown error'
}

/** True when this file is the process entry point (tsx scripts/lint/css-lint.ts), not an import. */
function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  const self = realFile(fileURLToPath(moduleUrl))
  const entry = realFile(resolve(argv1))
  return process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry
}

function realFile(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  process.exitCode = runCssLint(root, process.argv.slice(2), process.cwd(), (line) =>
    process.stdout.write(`${line}\n`),
  )
}
