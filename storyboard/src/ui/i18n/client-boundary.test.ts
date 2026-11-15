// The client boundary (P1 D4, D8; design p1-step7-design.md §3.12 #22, §5.3, §6.1, §8.1 item 5;
// P1-1c). Source files are read as text, so nothing here imports Next or the catalogues.
// - No file whose first statement is 'use client' reaches src/ui/i18n/messages.ts, messages/*.json
//   or src/config/launch.ts, directly or through relative or @/ imports (type-only imports count
//   too). The catalogue stays on the server, and the launch decision is never computed in a
//   browser, where process.env.READER_LAUNCH would be undefined. Every file under src/content (the
//   server-only content reader, design p1-step8-design.md §8; P1-2b) counts as server-only too.
// - Under app/, src/, scripts/ and e2e/, the string READER_LAUNCH appears only in
//   src/config/launch.ts and *.test.ts files (buildLaunch is its only reader).
// - Every source file under app/ and src/ that loads zod imports src/core/zod-jitless.ts first,
//   which turns zod's eval probe off before any schema is built (spec §9 CSP: no 'unsafe-eval';
//   the stores and zod reach every reader page, design §11 R10). Type-only imports are fine.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const toPosix = (path: string): string => path.split(sep).join('/')

/** The files a client component must never reach. */
const SERVER_ONLY = ['src/ui/i18n/messages.ts', 'src/config/launch.ts']
/** Folders whose every file is server-only: the content reader (P1-2b, design §8). */
const SERVER_ONLY_DIRS = ['src/content/']
const isServerOnly = (path: string): boolean =>
  SERVER_ONLY.includes(path) ||
  SERVER_ONLY_DIRS.some((dir) => path.startsWith(dir)) ||
  /^messages\/[^/]+\.json$/.test(path)

/** Every file under `dir` (relative to the storyboard root) whose name passes `keep`. */
function walk(dir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && keep(entry.name)) found.push(toPosix(relative(storyboard, path)))
    }
  }
  visit(join(storyboard, dir))
  return found.sort()
}

/** True when the first statement (after comments and blank lines) is the 'use client' directive. */
function isClientFile(source: string): boolean {
  const rest = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
  return /^(['"])use client\1/.test(rest)
}

/** Every module specifier in a file: static and type imports, re-exports, side effects, import(). */
function specifiers(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  const found: string[] = []
  const patterns = [
    /\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ]
  for (const pattern of patterns) for (const m of code.matchAll(pattern)) found.push(m[2] ?? '')
  return found
}

/**
 * The repo file a relative or @/ specifier names (as the bundler resolves it: the exact file, then
 * .ts, .tsx, /index.ts, /index.tsx), or undefined for a package or a file that does not exist.
 */
function resolveSpecifier(
  from: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | undefined {
  let base: string
  if (specifier.startsWith('@/')) base = posix.join('src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = posix.join(posix.dirname(from), specifier)
  else return undefined
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find(exists)
}

interface Violation {
  readonly client: string
  /** The import chain from the client file to the server-only file. */
  readonly chain: readonly string[]
}

/** Every client file that reaches a server-only file, with one shortest import chain each. */
function clientViolations(files: ReadonlyMap<string, string>): Violation[] {
  const exists = (path: string): boolean => files.has(path)
  const edges = (path: string): string[] =>
    specifiers(files.get(path) ?? '')
      .map((specifier) => resolveSpecifier(path, specifier, exists))
      .filter((target): target is string => target !== undefined)
  const violations: Violation[] = []
  for (const [client, source] of files) {
    if (!isClientFile(source)) continue
    const previous = new Map<string, string>([[client, '']])
    const queue = [client]
    let hit: string | undefined
    while (queue.length > 0 && hit === undefined) {
      const current = queue.shift() ?? ''
      for (const target of edges(current)) {
        if (previous.has(target)) continue
        previous.set(target, current)
        if (isServerOnly(target)) {
          hit = target
          break
        }
        queue.push(target)
      }
    }
    if (hit === undefined) continue
    const chain = [hit]
    for (let at = previous.get(hit); at !== undefined && at !== ''; at = previous.get(at)) {
      chain.unshift(at)
    }
    violations.push({ client, chain })
  }
  return violations
}

/** Every app/ and src/ source file plus the catalogues, as path → text. */
function repoGraph(): Map<string, string> {
  const paths = [
    ...walk('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...walk('src', (name) => /\.(ts|tsx)$/.test(name)),
    ...walk('messages', (name) => name.endsWith('.json')),
  ]
  return new Map(paths.map((path) => [path, readFileSync(join(storyboard, path), 'utf8')]))
}

describe('the client boundary scanner', () => {
  it('finds the directive only as the first statement', () => {
    expect(isClientFile("'use client'\nexport {}")).toBe(true)
    expect(isClientFile('"use client"\n')).toBe(true)
    expect(isClientFile("// header\n/* note */\n\n'use client'\n")).toBe(true)
    expect(isClientFile("import x from 'y'\n'use client'\n")).toBe(false)
    expect(isClientFile("// 'use client'\nexport {}\n")).toBe(false)
    expect(isClientFile("'use server'\n")).toBe(false)
  })

  it('reads static, type, side-effect, re-export and dynamic imports', () => {
    const source = [
      "import a from './a'",
      "import type { B } from '../b'",
      "import './c.css'",
      "export { d } from '@/d'",
      "const e = await import('./e')",
      "// import f from './f'",
    ].join('\n')
    expect(specifiers(source).sort()).toEqual(['../b', './a', './c.css', './e', '@/d'])
  })

  it('resolves relative and @/ specifiers like the bundler, and ignores packages', () => {
    const files = new Set(['src/ui/a.ts', 'src/ui/b/index.tsx', 'src/config/launch.ts'])
    const exists = (path: string): boolean => files.has(path)
    expect(resolveSpecifier('src/ui/x.tsx', './a', exists)).toBe('src/ui/a.ts')
    expect(resolveSpecifier('src/ui/x.tsx', './b', exists)).toBe('src/ui/b/index.tsx')
    expect(resolveSpecifier('app/p.tsx', '@/config/launch', exists)).toBe('src/config/launch.ts')
    expect(resolveSpecifier('src/ui/x.tsx', 'react', exists)).toBeUndefined()
    expect(resolveSpecifier('src/ui/x.tsx', './missing', exists)).toBeUndefined()
  })

  it('catches seeded violations, directly and through other files', () => {
    const files = new Map([
      [
        'src/ui/i18n/messages.ts',
        "import 'server-only'\nimport en from '../../../messages/en.json'",
      ],
      ['messages/en.json', '{}'],
      ['src/config/launch.ts', 'export const x = 1'],
      ['src/ui/helper.ts', "export { translator } from './i18n/messages'"],
      ['src/ui/direct.tsx', "'use client'\nimport { translator } from './i18n/messages'"],
      ['src/ui/indirect.tsx', "'use client'\nimport { translator } from './helper'"],
      ['src/ui/json.tsx', "'use client'\nimport en from '../../messages/en.json'"],
      ['app/flag.tsx', "'use client'\nimport type { LaunchDecision } from '@/config/launch'"],
      ['src/ui/server.tsx', "import { translator } from './i18n/messages'"],
      ['src/ui/clean.tsx', "'use client'\nimport { useState } from 'react'"],
    ])
    expect(clientViolations(files)).toEqual([
      { client: 'src/ui/direct.tsx', chain: ['src/ui/direct.tsx', 'src/ui/i18n/messages.ts'] },
      {
        client: 'src/ui/indirect.tsx',
        chain: ['src/ui/indirect.tsx', 'src/ui/helper.ts', 'src/ui/i18n/messages.ts'],
      },
      { client: 'src/ui/json.tsx', chain: ['src/ui/json.tsx', 'messages/en.json'] },
      { client: 'app/flag.tsx', chain: ['app/flag.tsx', 'src/config/launch.ts'] },
    ])
  })
})

describe('src/content is server-only (P1-2b, design p1-step8-design.md §8)', () => {
  it('counts every file under src/content, and nothing that only starts with the name', () => {
    expect(isServerOnly('src/content/index.ts')).toBe(true)
    expect(isServerOnly('src/content/reader.ts')).toBe(true)
    expect(isServerOnly('src/content/later/more.ts')).toBe(true)
    expect(isServerOnly('src/contentious.ts')).toBe(false)
    expect(isServerOnly('src/core/content/output-layout.ts')).toBe(false)
  })

  it('catches a client component that reaches src/content, directly or through other files', () => {
    const files = new Map([
      ['src/content/index.ts', "import 'server-only'\nexport { listStories } from './reader'"],
      ['src/content/reader.ts', "import 'server-only'\nexport const listStories = () => []"],
      ['src/content/later/more.ts', "import 'server-only'\nexport const more = 1"],
      ['src/ui/shelf.tsx', "'use client'\nimport { listStories } from '@/content'"],
      ['src/ui/helper.ts', "export { more } from '../content/later/more'"],
      ['src/ui/indirect.tsx', "'use client'\nimport { more } from './helper'"],
      ['app/page.tsx', "import { listStories } from '@/content'"],
      [
        'src/ui/clean.tsx',
        "'use client'\nimport { MEDIA_ORIGIN } from '../config/security-headers'",
      ],
      ['src/config/security-headers.ts', 'export const MEDIA_ORIGIN = 1'],
    ])
    expect(clientViolations(files)).toEqual([
      { client: 'src/ui/shelf.tsx', chain: ['src/ui/shelf.tsx', 'src/content/index.ts'] },
      {
        client: 'src/ui/indirect.tsx',
        chain: ['src/ui/indirect.tsx', 'src/ui/helper.ts', 'src/content/later/more.ts'],
      },
    ])
  })
})

describe('the client boundary in the repo', () => {
  const graph = repoGraph()
  const clients = [...graph].filter(([, source]) => isClientFile(source)).map(([path]) => path)

  it('scans the real client components (the scan is not empty)', () => {
    expect(clients).toEqual(
      expect.arrayContaining([
        'src/ui/shell/choice-recorder.tsx',
        'src/ui/shell/header-nav.tsx',
        'src/ui/shell/storage-banner.tsx',
      ]),
    )
    expect(graph.has('src/ui/i18n/messages.ts')).toBe(true)
    expect(graph.has('messages/en.json') && graph.has('messages/hi.json')).toBe(true)
  })

  it('no client component reaches the catalogues or the launch flag', () => {
    expect(clientViolations(graph)).toEqual([])
  })

  it('the server components that do use them are not client files', () => {
    for (const path of ['src/ui/i18n/messages.ts', 'src/config/launch.ts']) {
      expect(isClientFile(graph.get(path) ?? ''), path).toBe(false)
    }
  })

  it('scans the content reader, and none of its files is a client file (P1-2b)', () => {
    const content = [...graph.keys()].filter((path) => path.startsWith('src/content/'))
    expect(content).toEqual(
      expect.arrayContaining(['src/content/index.ts', 'src/content/reader.ts']),
    )
    expect(content.filter((path) => isClientFile(graph.get(path) ?? ''))).toEqual([])
  })
})

describe('READER_LAUNCH', () => {
  it('appears under app/, src/, scripts/ and e2e/ only in src/config/launch.ts and tests', () => {
    const text = (name: string): boolean => /\.(ts|tsx|mts|mjs|js|json|css)$/.test(name)
    const offenders = ['app', 'src', 'scripts', 'e2e']
      .flatMap((dir) => walk(dir, text))
      .filter((path) => path !== 'src/config/launch.ts' && !path.endsWith('.test.ts'))
      .filter((path) => readFileSync(join(storyboard, path), 'utf8').includes('READER_LAUNCH'))
    expect(offenders).toEqual([])
  })
})

/** The module that turns zod's eval probe off before any schema is built. */
const ZOD_JITLESS = 'src/core/zod-jitless.ts'
const ZOD = String.raw`(?<quote>['"])zod(?:\/[^'"]*)?\k<quote>`

/** Every statement in a file that loads zod at run time: not `import type` / `export type`. */
function zodValueImports(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  const found: string[] = []
  for (const m of code.matchAll(
    new RegExp(String.raw`\b(import|export)\s+([^'";]*?)\bfrom\s*${ZOD}`, 'g'),
  )) {
    if (!/^type\b/.test(m[2] ?? '')) found.push(m[0])
  }
  for (const m of code.matchAll(new RegExp(String.raw`\bimport\s*${ZOD}`, 'g'))) found.push(m[0])
  for (const m of code.matchAll(new RegExp(String.raw`\bimport\s*\(\s*${ZOD}\s*\)`, 'g'))) {
    found.push(m[0])
  }
  return found
}

/** The specifier of a file's first import, after comments, blank lines and a directive. */
function firstImport(source: string): string | undefined {
  const rest = source.replace(
    /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])use (?:client|server)\1;?)*/,
    '',
  )
  return /^import\s+(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1/.exec(rest)?.[2]
}

/** Every file that loads zod without importing zod-jitless first. */
function jitlessViolations(files: ReadonlyMap<string, string>): string[] {
  const exists = (path: string): boolean => files.has(path)
  return [...files]
    .filter(([path, source]) => path !== ZOD_JITLESS && zodValueImports(source).length > 0)
    .filter(([path, source]) => {
      const first = firstImport(source)
      return first === undefined || resolveSpecifier(path, first, exists) !== ZOD_JITLESS
    })
    .map(([path]) => path)
}

describe('zod-jitless first', () => {
  it('the scanner finds value imports and passes type-only ones', () => {
    expect(zodValueImports("import { z } from 'zod'")).toEqual(["import { z } from 'zod'"])
    expect(zodValueImports('import {\n  z,\n  type ZodType,\n} from "zod/v4"')).toHaveLength(1)
    expect(zodValueImports("export { z } from 'zod'")).toHaveLength(1)
    expect(zodValueImports("import 'zod'")).toHaveLength(1)
    expect(zodValueImports("const m = await import('zod')")).toHaveLength(1)
    expect(zodValueImports("import type { z } from 'zod'")).toEqual([])
    expect(zodValueImports("export type { ZodType } from 'zod'")).toEqual([])
    expect(zodValueImports("// import { z } from 'zod'\nimport x from './y'")).toEqual([])
    expect(zodValueImports("import { z } from 'zod-validation-error'")).toEqual([])
  })

  it('catches a module that loads zod without zod-jitless first', () => {
    const files = new Map([
      [ZOD_JITLESS, "import { config } from 'zod'\nconfig({ jitless: true })"],
      ['src/core/first.ts', "// header\nimport './zod-jitless'\nimport { z } from 'zod'"],
      ['src/core/package/deep.ts', "import '../zod-jitless'\nimport { z } from 'zod'"],
      ['app/client.tsx', "'use client'\nimport '@/core/zod-jitless'\nimport { z } from 'zod'"],
      ['src/core/types.ts', "import type { z } from 'zod'"],
      ['src/core/late.ts', "import { z } from 'zod'\nimport './zod-jitless'"],
      ['src/core/none.ts', "/* note */\nimport { z } from 'zod'"],
    ])
    expect(jitlessViolations(files)).toEqual(['src/core/late.ts', 'src/core/none.ts'])
  })

  it('every module under app/ and src/ that loads zod imports zod-jitless first', () => {
    const paths = ['app', 'src']
      .flatMap((dir) => walk(dir, (name) => /\.(ts|tsx)$/.test(name)))
      .filter((path) => !path.endsWith('.test.ts'))
    const files = new Map(paths.map((path) => [path, readFileSync(join(storyboard, path), 'utf8')]))
    const loaders = [...files].filter(([, source]) => zodValueImports(source).length > 0)
    expect(loaders.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        ZOD_JITLESS,
        'src/core/content/build-info.ts',
        'src/core/package/catalogue.ts',
        'src/core/package/v1.ts',
        'src/core/progress/records.ts',
        'src/core/validator/waivers.ts',
      ]),
    )
    expect(files.get(ZOD_JITLESS)).toContain('config({ jitless: true })')
    expect(jitlessViolations(files)).toEqual([])
  })
})
