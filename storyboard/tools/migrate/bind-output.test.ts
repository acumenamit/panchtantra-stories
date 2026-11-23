// P1-9a (Step 17) bind-output.ts: the media binder's local writer for migration-input/phase2 (design
// migration-input/p1-step17-design.md D17-22, D17-26, §3.22, A20, A34, A39; test plan 14.7: T17-12 to
// T17-14). Every sample writes only under its own OS temp folder (`s17-out-…`), through the real
// node:fs adapter or a recording, fault-injecting wrapper of it; the real-path and string-form samples
// inject realPath and the platform, so they run on both hosts. Titles start with their id; one
// expect.soft per claim, messages "(gN) <claim> <sample>"; preconditions are hard expects starting
// "precondition:".
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OutputError,
  nodeOutputFs,
  openOutput,
  type OutputDeps,
  type OutputFs,
  type OutputTarget,
} from './bind-output'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const enc = (text: string) => new TextEncoder().encode(text)

// ---- temp roots ----

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A new `<tmp>/s17-out-…/mi` folder (MI); P2 is `<mi>/phase2`, absent. */
function newMi(): string {
  const base = mkdtempSync(join(tmpdir(), 's17-out-'))
  roots.push(base)
  const mi = join(base, 'mi')
  mkdirSync(mi)
  return mi
}
const p2Of = (mi: string) => join(mi, 'phase2')

// ---- the fs adapter: recording and fault-injecting ----

interface Recording extends OutputFs {
  readonly calls: string[]
}

/** node:fs through the adapter, every call recorded as `<op> <path>`; `hooks` replace single ops. */
function recordingFs(hooks: Partial<OutputFs> = {}): Recording {
  const calls: string[] = []
  const base = { ...nodeOutputFs, ...hooks }
  return {
    calls,
    lstat: (path) => (calls.push(`lstat ${path}`), base.lstat(path)),
    readdir: (path) => (calls.push(`readdir ${path}`), base.readdir(path)),
    mkdir: (path) => (calls.push(`mkdir ${path}`), base.mkdir(path)),
    readFile: (path) => (calls.push(`readFile ${path}`), base.readFile(path)),
    writeFile: (path, bytes, options) => (
      calls.push(`writeFile ${path}`),
      base.writeFile(path, bytes, options)
    ),
    link: (from, to) => (calls.push(`link ${to}`), base.link(from, to)),
    unlink: (path) => (calls.push(`unlink ${path}`), base.unlink(path)),
    rename: (from, to) => (calls.push(`rename ${to}`), base.rename(from, to)),
  }
}

/** Hex draws start + 1, start + 2, ... (after any given first answers), 8 hex digits each. */
function hexes(first: readonly string[] = [], start = 0) {
  const queue = [...first]
  let n = start
  return () => queue.shift() ?? (++n).toString(16).padStart(8, '0')
}

function depsOf(fs: OutputFs = nodeOutputFs, over: Partial<OutputDeps> = {}): OutputDeps {
  return {
    fs,
    realPath: realpathSync.native,
    platform: process.platform,
    randomHex: hexes(),
    ...over,
  }
}

/** The OutputError code a call throws (its message must be the bare code), or 'ok'. */
function codeOf(run: () => unknown): string {
  try {
    run()
    return 'ok'
  } catch (error) {
    if (error instanceof OutputError) return error.message === error.code ? error.code : 'message'
    throw error
  }
}

/** Every file under `dir` (relative '/' path → sha256); links are listed, never followed. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    const abs = rel === '' ? dir : join(dir, ...rel.split('/'))
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      const child = rel === '' ? name : `${rel}/${name}`
      const stat = lstatSync(join(abs, name))
      if (stat.isSymbolicLink()) out[child] = 'link'
      else if (stat.isDirectory()) walk(child)
      else out[child] = sha(readFileSync(join(abs, name)))
    }
  }
  walk('')
  return out
}
const parts = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])
const media = (name: string, bytes: Uint8Array): OutputTarget => ({
  segments: ['media', 'two-paths', name],
  bytes,
})

const A = media('aaaa-w768.webp', enc('the bytes of A'))
const B = media('bbbb-w768.webp', enc('the bytes of B, a little longer than the others'))
const C = media('cccc-w768.webp', enc('the bytes of C'))
const at = (p2: string, target: OutputTarget) => join(p2, ...target.segments)
const put = (p2: string, target: OutputTarget, bytes: Uint8Array = target.bytes) => {
  mkdirSync(join(p2, ...target.segments.slice(0, -1)), { recursive: true })
  writeFileSync(at(p2, target), bytes)
}

/** A directory link (a junction on win32); null with the PB3 skip line where links are refused. */
function linkTo(target: string, link: string): string | null {
  try {
    symlinkSync(target, link, 'junction')
    return link
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      console.log('skipped: junction not creatable here (PB3)')
      return null
    }
    throw error
  }
}

// ---- T17-12 ----

describe('bind-output create-only writes (T17-12)', () => {
  it('T17-12 create-only writes: a unique wx temp, then a hard link; absent written, equal skipped, different refused before any write; a cut-off write never leaves a partial final file; a stale temp is kept and reported; each file re-read (A20, D17-22, CRIT-2, TP17-5)', () => {
    // Precondition: three new media files, each re-read equal, no .part left in P2/.tmp.
    {
      const p2 = p2Of(newMi())
      const out = openOutput(p2, depsOf(), 'write')
      const result = out.createAll([A, B, C])
      expect(result, 'precondition: three files written').toEqual({ written: 3, skipped: 0 })
      for (const t of [A, B, C]) {
        expect(sha(readFileSync(at(p2, t))), 'precondition: each file re-read equal').toBe(
          sha(t.bytes),
        )
      }
      expect(
        parts(join(p2, '.tmp')).filter((n) => n.endsWith('.part')),
        'precondition: no .part left',
      ).toEqual([])
    }

    // g1: the pre-check of the whole batch runs before any write.
    {
      const p2 = p2Of(newMi())
      openOutput(p2, depsOf(), 'write')
      put(p2, B)
      put(p2, C, enc('other bytes under the name of C'))
      const before = tree(p2)
      const out = openOutput(p2, depsOf(), 'write')
      expect
        .soft(
          codeOf(() => out.createAll([A, B, C])),
          '(g1) [new A, equal B, different C]',
        )
        .toBe('output-file-differs')
      expect.soft(tree(p2), '(g1) A not written: the tree is as before').toEqual(before)
    }

    // g2: a cut-off temp write leaves no partial final file; the temp stays under P2/.tmp.
    const mi = newMi()
    const p2 = p2Of(mi)
    const half = recordingFs({
      writeFile: (path, bytes, options) => {
        if (path.includes('bbbb-w768.webp')) {
          nodeOutputFs.writeFile(path, bytes.subarray(0, bytes.length >> 1), options)
          throw Object.assign(new Error('cut off'), { code: 'EIO' })
        }
        nodeOutputFs.writeFile(path, bytes, options)
      },
    })
    const cut = openOutput(p2, depsOf(half), 'write')
    expect
      .soft(
        codeOf(() => cut.createAll([B])),
        '(g2) a write cut off halfway',
      )
      .toBe('output-write')
    expect.soft(existsSync(at(p2, B)), "(g2) B's final name absent").toBe(false)
    const stale = parts(join(p2, '.tmp'))
    expect.soft(stale.length, '(g2) the temp is present under P2/.tmp').toBe(1)
    const outside = Object.keys(tree(join(p2, 'media'))).concat(
      Object.keys(tree(join(p2, 'masters'))),
    )
    expect
      .soft(
        outside.filter((n) => n.endsWith('.part')),
        '(g3) no .part under P2/media or P2/masters',
      )
      .toEqual([])

    // g3: the re-run draws a new hex past the stale temp's, keeps the temp and reports it.
    const staleHex = /\.[0-9]+-([0-9a-f]{8})\.part$/.exec(stale[0] ?? '')?.[1] ?? 'none'
    const rerun = recordingFs()
    const again = openOutput(p2, depsOf(rerun, { randomHex: hexes([staleHex], 0x100) }), 'write')
    expect.soft(again.staleParts, '(g3) the stale temp is reported').toBe(1)
    expect
      .soft(
        codeOf(() => again.createAll([B])),
        '(g3) the re-run writes B',
      )
      .toBe('ok')
    expect
      .soft(existsSync(at(p2, B)) && sha(readFileSync(at(p2, B))), '(g3) B written and equal')
      .toBe(sha(B.bytes))
    expect.soft(parts(join(p2, '.tmp')), '(g3) the stale temp is still present').toEqual(stale)
    expect
      .soft(
        rerun.calls.filter((c) => c.startsWith('writeFile')).length,
        '(g3) EEXIST on the stale hex, then a second draw',
      )
      .toBe(2)

    // g4: a file placed at the final name between the pre-check and the link.
    for (const sample of [
      { racing: B.bytes, want: 'ok', what: 'equal bytes' },
      { racing: enc('a racing writer'), want: 'output-file-differs', what: 'other bytes' },
    ]) {
      const p2r = p2Of(newMi())
      const race = recordingFs({
        link: (from, to) => {
          writeFileSync(to, sample.racing)
          nodeOutputFs.link(from, to)
        },
      })
      const out = openOutput(p2r, depsOf(race), 'write')
      let result: unknown = null
      const code = codeOf(() => (result = out.createAll([B])))
      expect.soft(code, `(g4) ${sample.what}`).toBe(sample.want)
      if (sample.want === 'ok')
        expect.soft(result, `(g4) ${sample.what}: skipped`).toEqual({ written: 0, skipped: 1 })
      expect
        .soft(sha(readFileSync(at(p2r, B))), `(g4) ${sample.what}: the racing bytes are kept`)
        .toBe(sha(sample.racing))
      expect
        .soft(
          race.calls.filter((c) => c.startsWith('unlink')),
          `(g4) ${sample.what}: no unlink after a failed link`,
        )
        .toEqual([])
    }

    // g5: a byte flipped as it is written is caught by the re-read.
    {
      const p2f = p2Of(newMi())
      const flip = recordingFs({
        writeFile: (path, bytes, options) => {
          const copy = new Uint8Array(bytes)
          copy[0] = (copy[0] ?? 0) ^ 0xff
          nodeOutputFs.writeFile(path, copy, options)
        },
      })
      const out = openOutput(p2f, depsOf(flip), 'write')
      expect
        .soft(
          codeOf(() => out.createAll([A])),
          '(g5) a flipped byte',
        )
        .toBe('output-write')
      expect.soft(existsSync(at(p2f, A)), '(g5) the final name absent').toBe(false)
    }

    // g6: a volume without hard links: output-write, the final name absent, the temp kept.
    for (const errno of ['EPERM', 'ENOSYS']) {
      const p2l = p2Of(newMi())
      const nolink = recordingFs({
        link: () => {
          throw Object.assign(new Error('no hard links'), { code: errno })
        },
      })
      const out = openOutput(p2l, depsOf(nolink), 'write')
      expect
        .soft(
          codeOf(() => out.createAll([A])),
          `(g6) link ${errno}`,
        )
        .toBe('output-write')
      expect.soft(existsSync(at(p2l, A)), `(g6) link ${errno}: the final name absent`).toBe(false)
      expect
        .soft(parts(join(p2l, '.tmp')).length, `(g6) link ${errno}: the temp kept in P2/.tmp`)
        .toBe(1)
      expect
        .soft(
          nolink.calls.filter((c) => c.startsWith('unlink')),
          `(g6) link ${errno}: no unlink`,
        )
        .toEqual([])
      expect
        .soft(
          openOutput(p2l, depsOf(), 'read').staleParts,
          `(g6) link ${errno}: the next run's stale-part count`,
        )
        .toBe(1)
    }
  })
})

// ---- T17-13 ----

describe('bind-output replaced files (T17-13)', () => {
  it('T17-13 atomic replace for packages, the ledger and the report: temp then rename; a failed rename keeps the old bytes (A20, D17-22)', () => {
    const X: OutputTarget = { segments: ['packages', 'two-paths.json'], bytes: enc('{"x":1}') }
    const Y: OutputTarget = { segments: ['packages', 'two-paths.json'], bytes: enc('{"y":22}') }
    const p2 = p2Of(newMi())
    openOutput(p2, depsOf(), 'write').replace(X)
    expect(sha(readFileSync(at(p2, X))), 'precondition: the package file holds X').toBe(
      sha(X.bytes),
    )

    // g1
    expect
      .soft(
        codeOf(() => openOutput(p2, depsOf(), 'write').replace(Y)),
        '(g1) X → Y',
      )
      .toBe('ok')
    expect.soft(sha(readFileSync(at(p2, Y))), '(g1) the file holds Y').toBe(sha(Y.bytes))
    expect
      .soft(
        parts(join(p2, '.tmp')).filter((n) => n.endsWith('.part')),
        '(g1) no temp left',
      )
      .toEqual([])
    const flip = recordingFs({
      writeFile: (path, bytes, options) => {
        const copy = new Uint8Array(bytes)
        copy[1] = (copy[1] ?? 0) ^ 0x01
        nodeOutputFs.writeFile(path, copy, options)
      },
    })
    expect
      .soft(
        codeOf(() => openOutput(p2, depsOf(flip), 'write').replace(X)),
        '(g1) a flipped byte',
      )
      .toBe('output-write')
    expect.soft(sha(readFileSync(at(p2, Y))), '(g1) a flipped byte: Y kept').toBe(sha(Y.bytes))

    // g2
    const norename = recordingFs({
      rename: () => {
        throw Object.assign(new Error('rename refused'), { code: 'EBUSY' })
      },
    })
    expect
      .soft(
        codeOf(() => openOutput(p2, depsOf(norename), 'write').replace(X)),
        '(g2) the rename throws',
      )
      .toBe('output-write')
    expect
      .soft(sha(readFileSync(at(p2, X))), '(g2) the file keeps its bytes byte for byte')
      .toBe(sha(Y.bytes))
  })
})

// ---- T17-14 ----

/** An fs adapter over nothing: every lstat answers ENOENT, every other call is recorded and refused. */
function emptyFs(): Recording {
  const calls: string[] = []
  const refuse = (op: string) => (path: string) => {
    calls.push(`${op} ${path}`)
    throw Object.assign(new Error(op), { code: op === 'lstat' ? 'ENOENT' : 'EACCES' })
  }
  return {
    calls,
    lstat: refuse('lstat'),
    readdir: refuse('readdir'),
    mkdir: refuse('mkdir'),
    readFile: refuse('readFile'),
    writeFile: (path) => refuse('writeFile')(path),
    link: (_from, to) => refuse('link')(to),
    unlink: refuse('unlink'),
    rename: (_from, to) => refuse('rename')(to),
  }
}

describe('bind-output guards (T17-14)', () => {
  it("T17-14 the output root and every folder on a path: real folders only; MI's real path checked before P2 exists and P2's after mkdir, folded as D15-28; device, network and unstorable forms refused before any fs call; segments by the segment rule (A20, D17-22, CRIT-7, TP17-4, TP17-5)", () => {
    {
      const p2 = p2Of(newMi())
      const out = openOutput(p2, depsOf(), 'write')
      expect(out.createAll([A]), 'precondition: P2 created and one file written').toEqual({
        written: 1,
        skipped: 0,
      })
    }

    // g1: MI checked before P2 exists; P2 checked after mkdir.
    {
      const mi = newMi()
      const p2 = p2Of(mi)
      const fs = recordingFs()
      const miOther = (path: string) =>
        path === realpathSync.native(mi) || path === mi ? join(mi, 'elsewhere') : path
      expect
        .soft(
          codeOf(() => openOutput(p2, depsOf(fs, { realPath: miOther }), 'write')),
          '(g1) MI answers as another path',
        )
        .toBe('output-not-real')
      expect
        .soft(
          fs.calls.filter((c) => c.startsWith('mkdir')),
          '(g1) MI answers as another path: no mkdir',
        )
        .toEqual([])
      expect.soft(existsSync(p2), '(g1) MI answers as another path: P2 absent').toBe(false)

      const fs2 = recordingFs()
      const p2Other = (path: string) =>
        existsSync(path) && path.endsWith('phase2')
          ? join(mi, 'elsewhere')
          : realpathSync.native(path)
      expect
        .soft(
          codeOf(() => openOutput(p2, depsOf(fs2, { realPath: p2Other }), 'write').createAll([A])),
          '(g1) P2 answers as another path after mkdir',
        )
        .toBe('output-not-real')
      expect
        .soft(
          fs2.calls.filter((c) => c.startsWith('writeFile')),
          '(g1) P2 answers as another path: no file written',
        )
        .toEqual([])
    }

    // g2: real-path forms (injected realPath, the platform injected; both hosts).
    const realForms = (
      platform: string,
      p2: string,
      real: string,
    ): { code: string; calls: string[] } => {
      const fs = emptyFs()
      const code = codeOf(() =>
        openOutput(p2, depsOf(fs, { platform, realPath: () => real }), 'read'),
      )
      return { code, calls: fs.calls }
    }
    const refusedForms: [string, string, string][] = [
      ['a mapped drive', 'Z:\\mi\\phase2', '\\\\host\\share\\mi'],
      ['a Volume device path', 'D:\\mi\\phase2', '\\\\?\\Volume{0}\\mi'],
      ['a Volume path', 'D:\\mi\\phase2', 'Volume{0}\\mi'],
      ['an 8.3 pair', 'C:\\Users\\LONGNA~1\\mi\\phase2', 'C:\\Users\\Longname\\mi'],
      ['a subst pair', 'Z:\\mi\\phase2', 'D:\\data\\mi'],
    ]
    for (const [what, p2, real] of refusedForms) {
      expect.soft(realForms('win32', p2, real).code, `(g2) win32 ${what}`).toBe('output-not-real')
    }
    const casePairs: [string, string, string][] = [
      ['a case-only pair', 'C:\\X\\MI\\phase2', 'c:\\x\\mi'],
      ['U+0131 and I', 'C:\\data\\\u0131\\phase2', 'C:\\data\\I'],
      ['U+017F and S', 'C:\\data\\\u017f\\phase2', 'C:\\data\\S'],
    ]
    for (const [what, p2, real] of casePairs) {
      expect.soft(realForms('win32', p2, real).code, `(g2) win32 ${what} is accepted`).toBe('ok')
    }
    const linuxPairs: [string, string, string][] = [
      ['a case-only pair', '/X/MI/phase2', '/x/mi'],
      ['U+0131 and I', '/data/\u0131/phase2', '/data/I'],
      ['U+017F and S', '/data/\u017f/phase2', '/data/S'],
    ]
    for (const [what, p2, real] of linuxPairs) {
      expect
        .soft(realForms('linux', p2, real).code, `(g2) linux ${what} is refused`)
        .toBe('output-not-real')
    }

    // g3: string forms refused before any fs or realPath call.
    const stringForms: [string, string][] = [
      ['win32', '\\\\?\\C:\\mi\\phase2'],
      ['win32', '\\\\.\\C:\\mi\\phase2'],
      ['win32', '\\\\host\\share\\mi\\phase2'],
      ['win32', '//host/share/mi/phase2'],
      ['linux', '\\\\?\\C:\\mi\\phase2'],
      ['linux', '\\\\.\\C:\\mi\\phase2'],
      ['linux', '\\\\host\\share\\mi\\phase2'],
      ['linux', '//host/share/mi/phase2'],
      ['win32', 'C:\\x\\mi.\\phase2'],
      ['win32', 'C:\\x\\mi \\phase2'],
      ['win32', 'C:\\x\\mi:ads\\phase2'],
    ]
    for (const [platform, p2] of stringForms) {
      const fs = emptyFs()
      const realCalls: string[] = []
      const code = codeOf(() =>
        openOutput(
          p2,
          depsOf(fs, {
            platform,
            realPath: (path) => {
              realCalls.push(path)
              throw new Error('realPath')
            },
          }),
          'write',
        ),
      )
      expect.soft(code, `(g3) ${platform} ${JSON.stringify(p2)}`).toBe('output-not-real')
      expect
        .soft(
          [...fs.calls, ...realCalls],
          `(g3) ${platform} ${JSON.stringify(p2)}: no fs or realPath call`,
        )
        .toEqual([])
    }

    // g4: links and folders on a path.
    const linkSamples: [string, readonly string[], OutputTarget][] = [
      ['P2', [], A],
      ['P2/media', ['media'], A],
      ['P2/media/<story>', ['media', 'two-paths'], A],
      [
        'P2/masters/images',
        ['masters', 'images'],
        { segments: ['masters', 'images', 'two-paths', 'm.png'], bytes: enc('m') },
      ],
    ]
    for (const [what, linkAt, target] of linkSamples) {
      const mi = newMi()
      const p2 = p2Of(mi)
      const elsewhere = join(mi, 'elsewhere')
      mkdirSync(elsewhere)
      if (linkAt.length > 0) {
        mkdirSync(join(p2, ...linkAt.slice(0, -1)), { recursive: true })
      }
      if (linkTo(elsewhere, join(p2, ...linkAt)) === null) continue
      const before = tree(mi)
      const code = codeOf(() => openOutput(p2, depsOf(), 'write').createAll([target]))
      expect.soft(code, `(g4) a link at ${what}`).toBe('output-not-directory')
      expect.soft(tree(mi), `(g4) a link at ${what}: nothing written`).toEqual(before)
      expect.soft(parts(elsewhere), `(g4) a link at ${what}: nothing through it`).toEqual([])
    }
    {
      const p2 = p2Of(newMi())
      mkdirSync(p2)
      writeFileSync(join(p2, 'media'), 'a file where a folder belongs')
      const before = tree(p2)
      expect
        .soft(
          codeOf(() => openOutput(p2, depsOf(), 'write').createAll([A])),
          '(g4) a file where P2/media belongs',
        )
        .toBe('output-not-directory')
      expect.soft(tree(p2), '(g4) a file where P2/media belongs: nothing written').toEqual(before)
    }
    {
      const p2 = p2Of(newMi())
      put(p2, A)
      const failing = recordingFs({
        readdir: (path) => {
          if (path.endsWith('media')) throw Object.assign(new Error('list'), { code: 'EIO' })
          return nodeOutputFs.readdir(path)
        },
      })
      expect
        .soft(
          codeOf(() => openOutput(p2, depsOf(failing), 'read').list(['media'])),
          '(g4) a P2/media listing that fails',
        )
        .toBe('output-not-directory')
    }

    // g5: segments.
    for (const segment of ['..', '.', 'a/b', 'a\\b', '', 'a:b', 'a%2fb']) {
      const p2 = p2Of(newMi())
      const fs = recordingFs()
      const out = openOutput(p2, depsOf(fs), 'write')
      const before = tree(p2)
      const target = { segments: ['media', segment, 'x.webp'], bytes: enc('x') }
      expect
        .soft(
          codeOf(() => out.createAll([target])),
          `(g5) segment ${JSON.stringify(segment)}`,
        )
        .toBe('output-path')
      expect
        .soft(
          codeOf(() => out.replace({ segments: ['packages', segment], bytes: enc('x') })),
          `(g5) segment ${JSON.stringify(segment)} (replace)`,
        )
        .toBe('output-path')
      expect
        .soft(tree(p2), `(g5) segment ${JSON.stringify(segment)}: nothing written`)
        .toEqual(before)
    }
  })
})
