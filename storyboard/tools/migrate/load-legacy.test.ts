// SEC3-1 (design migration-input/p1-step16-design.md §3.21, §14.9; D16-21; P1 Step 16): the legacy
// loader checks the frozen file set, strict UTF-8 and every LF sha256 before it evaluates anything,
// reads each file once and evaluates the text it read, in a null-prototype vm context. Synthetic
// modules only, each test with its own frozen map: no legacy story text is copied and pt/ is never
// read here. Every folder is an OS temp folder removed after the test.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateLegacyModule, loadFrozenLegacyStories, loadLegacyStories } from './load-legacy'

const PLAIN = 'const A = { a: [1] }; export default A;\n'
const TEMPLATE = 'const B = { b: `two\nlines` }; export default B;\n'
const SECOND = "const A = { a: ['second'] }; export default A;\n"
const EVALUATED = "const A = (() => { throw new Error('EVALUATED') })(); export default A;\n"
const SET_ERROR = 'legacy stories: the file set differs from the frozen manifest'

const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const keyOf = (file: string) => `pt/src/stories/${file}`
/** The frozen map of a file set: each LF text's sha256 under its manifest key. */
const frozenOf = (files: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(files).map(([file, text]) => [keyOf(file), sha(text.replace(/\r\n/g, '\n'))]),
  )

let roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

/** A temp folder holding `files` (text or bytes) and the empty folders `dirs`. */
function folder(files: Readonly<Record<string, string | Uint8Array>>, dirs: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 's16-legacy-'))
  roots.push(dir)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  for (const name of dirs) mkdirSync(join(dir, name))
  return dir
}

type Outcome<T> = { readonly value: T; readonly error: null } | { readonly error: string }

/** Runs `run`, keeping its value or its error message (never a crash of the test). */
function attempt<T>(run: () => T): Outcome<T> {
  try {
    return { value: run(), error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const errorOf = (outcome: Outcome<unknown>) => outcome.error

describe('load-legacy (SEC3-1)', () => {
  it('T16-23 loadFrozenLegacyStories reads each file once as strict UTF-8, hashes the LF text, refuses any set or hash difference before evaluating anything, and loadLegacyStories goes through it (A20, CRIT-16, TP16-7)', () => {
    const files = { 'a.js': PLAIN, 'b.js': TEMPLATE }
    const frozen = frozenOf(files)
    const ignored = { 'index.js': EVALUATED, 'notes.txt': 'not a module' }
    const lf = folder({ ...files, ...ignored })
    const crlf = folder({
      'a.js': PLAIN.replace(/\n/g, '\r\n'),
      'b.js': TEMPLATE.replace(/\n/g, '\r\n'),
      ...ignored,
    })
    expect(
      ['a.js', 'b.js', 'index.js', 'notes.txt'].every(
        (name) => existsSync(join(lf, name)) && existsSync(join(crlf, name)),
      ),
      'precondition: the synthetic files exist',
    ).toBe(true)
    expect(
      readFileSync(join(crlf, 'a.js')).includes('\r\n'),
      'precondition: the CRLF copy holds CRLF',
    ).toBe(true)

    // g1: a matching set loads in sorted order with the LF hash; CRLF hashes equal; index.js and
    // non-.js names are ignored.
    const loaded = attempt(() => loadFrozenLegacyStories(lf, frozen))
    expect.soft(errorOf(loaded), '(g1) a matching set with index.js and notes.txt loads').toBeNull()
    if (loaded.error === null) {
      expect
        .soft(
          loaded.value.map((l) => [l.file, l.sourceSha256, l.story]),
          '(g1) each file with its LF sha256 and its evaluated module',
        )
        .toEqual([
          ['a.js', sha(PLAIN), { a: [1] }],
          ['b.js', sha(TEMPLATE), { b: 'two\nlines' }],
        ])
    }
    const fromCrlf = attempt(() => loadFrozenLegacyStories(crlf, frozen))
    expect.soft(errorOf(fromCrlf), '(g1) a CRLF copy loads against the LF hashes').toBeNull()
    if (fromCrlf.error === null) {
      expect
        .soft(
          fromCrlf.value.map((l) => l.sourceSha256),
          '(g1) a CRLF copy hashes equal to its LF text',
        )
        .toEqual([sha(PLAIN), sha(TEMPLATE)])
    }
    const reversed = attempt(() =>
      loadFrozenLegacyStories(lf, frozen, {
        list: () => ['notes.txt', 'index.js', 'b.js', 'a.js'],
        read: (path) => readFileSync(path),
      }),
    )
    expect
      .soft(
        reversed.error === null ? reversed.value.map((l) => l.file) : reversed.error,
        '(g1) a listing in reverse order loads in sorted order',
      )
      .toEqual(['a.js', 'b.js'])

    // g2: the set refusals, never an evaluation. a.js throws EVALUATED if it is ever evaluated.
    const evaluatedFirst = { 'a.js': EVALUATED, 'b.js': PLAIN }
    const frozenAB = frozenOf(evaluatedFirst)
    const bytesOf = (dir: string, names: readonly string[]) => ({
      list: () => names,
      read: (path: string) => {
        const name = basename(path)
        if (name !== 'a.js' && name !== 'b.js') throw new Error(`no file ${name}`)
        return readFileSync(join(dir, name))
      },
    })
    const ab = folder(evaluatedFirst)
    const setSamples: [string, () => unknown][] = [
      [
        'an extra c.js',
        () => loadFrozenLegacyStories(folder({ ...evaluatedFirst, 'c.js': PLAIN }), frozenAB),
      ],
      ['b.js missing', () => loadFrozenLegacyStories(folder({ 'a.js': EVALUATED }), frozenAB)],
      [
        'b2.js for b.js',
        () => loadFrozenLegacyStories(folder({ 'a.js': EVALUATED, 'b2.js': PLAIN }), frozenAB),
      ],
      ['A.js for a.js', () => loadFrozenLegacyStories(ab, frozenAB, bytesOf(ab, ['A.js', 'b.js']))],
      [
        'Index.js beside the set',
        () => loadFrozenLegacyStories(ab, frozenAB, bytesOf(ab, ['Index.js', 'a.js', 'b.js'])),
      ],
      [
        'a folder named c.js',
        () => loadFrozenLegacyStories(folder(evaluatedFirst, ['c.js']), frozenAB),
      ],
      ['an empty folder with an empty map', () => loadFrozenLegacyStories(folder({}), {})],
    ]
    for (const [label, run] of setSamples) {
      expect
        .soft(errorOf(attempt(run)), `(g2) the set error, never EVALUATED: ${label}`)
        .toBe(SET_ERROR)
    }

    // g3: every hash is checked before any evaluation.
    const changed = folder({ 'a.js': EVALUATED, 'b.js': TEMPLATE })
    expect
      .soft(
        errorOf(attempt(() => loadFrozenLegacyStories(changed, frozenAB))),
        '(g3) a changed b.js is refused by its hash before a.js is evaluated',
      )
      .toBe('b.js: source hash differs from the frozen manifest')

    // g4: each file is read once, and the text read is the text evaluated.
    const calls = new Map<string, number>()
    const once = folder(files)
    const readOnce = attempt(() =>
      loadFrozenLegacyStories(once, frozen, {
        list: () => ['a.js', 'b.js'],
        read: (path) => {
          const name = basename(path)
          const count = (calls.get(name) ?? 0) + 1
          calls.set(name, count)
          return count === 1 ? readFileSync(join(once, name)) : Buffer.from(SECOND, 'utf8')
        },
      }),
    )
    expect
      .soft(
        readOnce.error === null ? readOnce.value.map((l) => l.story) : readOnce.error,
        '(g4) the modules evaluated are the bytes of the one read',
      )
      .toEqual([{ a: [1] }, { b: 'two\nlines' }])
    expect.soft([...calls.entries()], '(g4) read was called once per file').toEqual([
      ['a.js', 1],
      ['b.js', 1],
    ])

    // g5: ill-formed UTF-8 is refused before any evaluation, even when the frozen value is the hash
    // of its U+FFFD-replaced text.
    for (const [label, bad] of [
      ['ED A0 80 (an encoded surrogate)', [0xed, 0xa0, 0x80]],
      ['C3 28 (a cut sequence)', [0xc3, 0x28]],
    ] as const) {
      const bytes = Buffer.concat([
        Buffer.from("const B = { b: '", 'utf8'),
        Buffer.from(bad),
        Buffer.from("' }; export default B;\n", 'utf8'),
      ])
      const replaced = new TextDecoder('utf-8').decode(bytes)
      const frozenBad = { [keyOf('a.js')]: sha(EVALUATED), [keyOf('b.js')]: sha(replaced) }
      expect
        .soft(
          errorOf(
            attempt(() =>
              loadFrozenLegacyStories(folder({ 'a.js': EVALUATED, 'b.js': bytes }), frozenBad),
            ),
          ),
          `(g5) invalid UTF-8 is refused before any evaluation: ${label}`,
        )
        .toBe('b.js: source is not valid UTF-8')
    }

    // g6: loadLegacyStories checks the real manifest's frozen set (11 names).
    expect
      .soft(
        errorOf(attempt(() => loadLegacyStories(folder({ 'a.js': PLAIN })))),
        '(g6) loadLegacyStories refuses a folder that is not the frozen set',
      )
      .toBe(SET_ERROR)
  })

  it('T16-24 evaluateLegacyModule runs in a null-prototype context: the constructor-chain escape throws, plain modules still evaluate (A20; L-L3)', () => {
    const escape =
      "const A = { p: this.constructor.constructor('return process')().pid }; export default A;\n"
    const escaped = attempt(() => evaluateLegacyModule(escape, 'escape.js'))
    expect.soft(escaped.error, '(g1) the constructor-chain escape throws').not.toBeNull()
    expect
      .soft(
        escaped.error === null ? typeof (escaped.value as unknown as { p?: unknown }).p : 'none',
        '(g1) and no number (a host pid) is returned',
      )
      .not.toBe('number')

    const plain = attempt(() => evaluateLegacyModule(PLAIN, 'plain.js'))
    expect
      .soft(
        plain.error === null ? plain.value : plain.error,
        '(g2) a plain module evaluates to its JSON round trip',
      )
      .toEqual({ a: [1] })
    const template = attempt(() => evaluateLegacyModule(TEMPLATE, 'template.js'))
    expect
      .soft(
        template.error === null ? template.value : template.error,
        '(g2) a template-literal module evaluates to its JSON round trip',
      )
      .toEqual({ b: 'two\nlines' })
  })
})
