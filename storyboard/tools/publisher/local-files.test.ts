// Step 14 (P1-8c) local-files.ts: safe local reads (design migration-input/p1-step14-design.md §6,
// §9 L3, TP-4, PB2, PB3; test plan §14.3: T14-7 to T14-12). vi.mock wraps each node:fs function the
// module uses in a vi.fn around the real one (the pattern of storage-recheck.test.ts:13-22), so a
// test can count calls and change one answer. Every file is written under an OS temp folder and
// removed after the test. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLocalFile, type LocalRead } from './local-files'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    readdirSync: vi.fn(real.readdirSync),
    lstatSync: vi.fn(real.lstatSync),
    readFileSync: vi.fn(real.readFileSync),
  }
})

const wrapped = [fs.readdirSync, fs.lstatSync, fs.readFileSync].map((fn) => vi.mocked(fn))
const callsOfWrapped = (): number => wrapped.reduce((n, fn) => n + fn.mock.calls.length, 0)

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 's14-lf-'))
  for (const fn of wrapped) fn.mockClear()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const write = (relative: string, bytes: Uint8Array | string): string => {
  const path = join(root, relative)
  fs.mkdirSync(join(path, '..'), { recursive: true })
  fs.writeFileSync(path, bytes)
  return path
}
const codeOf = (read: LocalRead): string => (read.ok ? 'ok' : read.code)

/** Creates a link, or answers 'skip' on win32 when this PC may not (PB3: EPERM or EACCES only). */
function tryLink(target: string, path: string, type: 'file' | 'dir' | 'junction'): 'ok' | 'skip' {
  try {
    fs.symlinkSync(target, path, type)
    return 'ok'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return 'skip'
    throw error
  }
}

describe('local-files: readLocalFile', () => {
  it('T14-7 reads a regular file by checked segments as exact bytes; the cap is inclusive', () => {
    write('a.json', new Uint8Array([0x41, 0xff, 0x42]))
    expect(fs.statSync(join(root, 'a.json')).size, 'precondition: a lone 0xFF among ASCII').toBe(3)
    const read = readLocalFile(root, ['a.json'], 3)
    expect.soft(read.ok && [...read.bytes], '(g1) the bytes are equal').toEqual([0x41, 0xff, 0x42])
    expect
      .soft(
        read.ok &&
          read.bytes.byteOffset === 0 &&
          read.bytes.buffer.byteLength === read.bytes.byteLength,
        '(g1) over an exact ArrayBuffer',
      )
      .toBe(true)
    expect
      .soft(codeOf(readLocalFile(root, ['a.json'], 3)), '(g2) exactly the cap is read')
      .toBe('ok')
    write('b.json', new Uint8Array(4))
    expect
      .soft(codeOf(readLocalFile(root, ['b.json'], 3)), '(g2) cap + 1 is local-file-too-large')
      .toBe('local-file-too-large')
  })

  it('T14-8 segments: the rule first, before any fs call; a refused segment is local-file-path (TP-4)', () => {
    write('a-b_c.d@1.json', '{}')
    write('a..b.json', '{}')
    expect(
      codeOf(readLocalFile(root, ['a-b_c.d@1.json'], 10)),
      'precondition: plain name read',
    ).toBe('ok')
    expect(
      codeOf(readLocalFile(root, ['a..b.json'], 10)),
      'precondition: near miss a..b read',
    ).toBe('ok')
    const samples = [
      '',
      '.',
      '..',
      'a\\b',
      'a/b',
      'C:',
      'C:x',
      '/x',
      'x/',
      'a b',
      'a\u0000',
      'é.json',
      'a:b',
      '~',
    ]
    for (const segment of samples) {
      for (const fn of wrapped) fn.mockClear()
      const read = readLocalFile(root, [segment], 10)
      expect.soft(codeOf(read), `(g1) refused ${JSON.stringify(segment)}`).toBe('local-file-path')
      expect.soft(callsOfWrapped(), `(g2) no fs call for ${JSON.stringify(segment)}`).toBe(0)
    }
  })

  it('T14-9 exact case: another case of a file or a folder is local-file-missing on both OSes, like an absent name (PB2)', () => {
    write('a.json', '{}')
    write(join('sub', 'a.json'), '{}')
    const wrongCaseOpens = (() => {
      try {
        return fs.statSync(join(root, 'A.json')).isFile()
      } catch (error) {
        return (error as NodeJS.ErrnoException).code
      }
    })()
    expect(
      wrongCaseOpens,
      'precondition: win32 opens the wrong case (the check refuses), Linux answers ENOENT',
    ).toBe(process.platform === 'win32' ? true : 'ENOENT')
    expect
      .soft(codeOf(readLocalFile(root, ['A.json'], 10)), '(g1) leaf A.json for a.json')
      .toBe('local-file-missing')
    expect
      .soft(
        codeOf(readLocalFile(root, ['Sub', 'a.json'], 10)),
        '(g1) folder Sub/a.json for sub/a.json',
      )
      .toBe('local-file-missing')
    expect
      .soft(codeOf(readLocalFile(root, ['zz.json'], 10)), '(g2) an absent name')
      .toBe('local-file-missing')
    expect
      .soft(codeOf(readLocalFile(join(root, 'nowhere'), ['a.json'], 10)), '(g2) an absent root')
      .toBe('local-file-missing')
  })

  it('T14-10 links: a symbolic link or junction on any segment, or a non-regular leaf, is local-file-not-regular (PB3)', () => {
    write(join('real', 'a.json'), '{}')
    write('target.json', '{}')
    expect(
      codeOf(readLocalFile(root, ['real', 'a.json'], 10)),
      'precondition: the real path reads',
    ).toBe('ok')

    expect(
      tryLink(join(root, 'real'), join(root, 'jn'), 'junction'),
      'precondition: junction made',
    ).toBe('ok')
    expect(fs.lstatSync(join(root, 'jn')).isSymbolicLink(), 'precondition: lstat sees a link').toBe(
      true,
    )
    expect
      .soft(
        codeOf(readLocalFile(root, ['jn', 'a.json'], 10)),
        '(g1) a junction as a folder segment',
      )
      .toBe('local-file-not-regular')

    if (tryLink(join(root, 'real'), join(root, 'ds'), 'dir') === 'skip') {
      console.log('skipped: directory symlink not creatable here (PB3)')
    } else {
      expect(fs.lstatSync(join(root, 'ds')).isSymbolicLink(), 'precondition: dir link made').toBe(
        true,
      )
      expect
        .soft(
          codeOf(readLocalFile(root, ['ds', 'a.json'], 10)),
          '(g2) a directory symlink as a folder segment',
        )
        .toBe('local-file-not-regular')
    }

    if (tryLink(join(root, 'target.json'), join(root, 'fl.json'), 'file') === 'skip') {
      console.log('skipped: file symlink not creatable here (PB3)')
    } else {
      expect(
        fs.lstatSync(join(root, 'fl.json')).isSymbolicLink(),
        'precondition: file link made',
      ).toBe(true)
      expect
        .soft(codeOf(readLocalFile(root, ['fl.json'], 10)), '(g3) a file symlink as the leaf')
        .toBe('local-file-not-regular')
    }

    expect
      .soft(codeOf(readLocalFile(root, ['real'], 10)), '(g4) a directory as the leaf')
      .toBe('local-file-not-regular')
  })

  it('T14-11 length re-check: a read whose length differs from the stat is local-file-changed (TP-5)', () => {
    write('a.json', '{"a":1}')
    expect(
      codeOf(readLocalFile(root, ['a.json'], 100)),
      'precondition: the wrappers call through',
    ).toBe('ok')
    const real = vi.mocked(fs.readFileSync).getMockImplementation()
    expect(typeof real, 'precondition: the wrapper has the real implementation').toBe('function')
    const longer = Buffer.from('{"a":1}x')
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => longer)
    expect
      .soft(codeOf(readLocalFile(root, ['a.json'], 100)), '(g1) one byte more than the stat')
      .toBe('local-file-changed')
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => Buffer.from('{"a":1'))
    expect
      .soft(codeOf(readLocalFile(root, ['a.json'], 100)), '(g2) one byte fewer than the stat')
      .toBe('local-file-changed')
  })

  it('T14-12 no result or error carries the root, a segment or an absolute path', () => {
    const canaryRoot = fs.mkdtempSync(join(root, 'S14CANARYPATH-'))
    const seg = 'S14CANARYSEG.json'
    fs.writeFileSync(join(canaryRoot, seg), '{"a":1}')
    fs.mkdirSync(join(canaryRoot, 'S14CANARYDIR'))
    fs.writeFileSync(join(canaryRoot, 'S14CANARYBIG.json'), '0123456789')
    const changed = (): LocalRead => {
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => Buffer.from('{"a":1}xx'))
      return readLocalFile(canaryRoot, [seg], 100)
    }
    const cases: [string, () => LocalRead][] = [
      ['local-file-path', () => readLocalFile(canaryRoot, ['S14CANARY SEG'], 100)],
      ['local-file-missing', () => readLocalFile(canaryRoot, ['S14CANARYNONE.json'], 100)],
      ['local-file-not-regular', () => readLocalFile(canaryRoot, ['S14CANARYDIR'], 100)],
      ['local-file-too-large', () => readLocalFile(canaryRoot, ['S14CANARYBIG.json'], 5)],
      ['local-file-changed', changed],
    ]
    const outcomes = cases.map(([code, run]) => {
      try {
        return { code, result: run() as unknown, thrown: null as unknown }
      } catch (error) {
        return { code, result: null as unknown, thrown: error }
      }
    })
    expect(
      outcomes.map((o) => (o.result as { code?: string } | null)?.code),
      'precondition: each refusal of T14-8 to T14-11 occurred',
    ).toEqual(cases.map(([code]) => code))
    for (const outcome of outcomes) {
      expect
        .soft(outcome.result, `(g1) the result is exactly {ok: false, code}: ${outcome.code}`)
        .toStrictEqual({ ok: false, code: outcome.code })
      const text = JSON.stringify(outcome.result) + String(outcome.thrown ?? '')
      expect
        .soft(text.includes('S14CANARY'), `(g2) no canary or segment: ${outcome.code}`)
        .toBe(false)
      expect.soft(text.includes(root), `(g2) no absolute path: ${outcome.code}`).toBe(false)
    }
  })
})
