// Step 16 (P1-8e) fixture-store.ts: the --fixtures world (design migration-input/p1-step16-design.md
// §3.15, D16-15; test plan §14.4: T16-12 to T16-14). The world only: the P1-8 exit matrix runs once,
// through runCli, in cli.test.ts (TP16-11). Titles start with their id; one expect.soft per claim,
// messages "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
// T16-13 g2 builds one real client on the loopback stub (fake key assembled at run time) behind the
// loopback guard on the global fetch (cli.test.ts pattern); nothing else here opens a connection, and
// nothing is written to disk.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planMediaHeads } from '../../src/core/content/media'
import { sha256Hex } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { readCatalogueState } from './catalogue-state'
import { Secret } from './env'
import { fixtureFacts, openFixtureSet } from './fixture-store'
import type { FixtureSet, StoredObject } from './port'
import {
  answersOf,
  approvalRecordOf,
  buildTestStories,
  fullyBoundStory,
  withPackage,
  type TestStory,
} from './stage-testkit'
import { createStorageClient } from './storage'
import { classOfPath } from './storage-layout'
import { expectNoUnexpected, startStorageStub, type StorageStub } from './storage-stub'

// Assembled at run time, so no file holds a string shaped like a real key.
const FAKE_KEY = ['sb', 'secret', 'fake-fixture-store-test-key'].join('_')
const ON = '2026-11-22'
const TIMEOUT = { timeout: 60_000 }

// ---- loopback guard ----

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const realFetch = globalThis.fetch
let escapes = 0
const stubs: StorageStub[] = []

beforeEach(() => {
  escapes = 0
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
    escapes++
    return Promise.reject(new TypeError('blocked: not a loopback host'))
  })
})

afterEach(async () => {
  const problems: unknown[] = []
  for (const stub of stubs.splice(0)) {
    try {
      expectNoUnexpected(stub)
    } catch (error) {
      problems.push(error)
    }
    await stub.close()
  }
  const count = escapes
  vi.unstubAllGlobals()
  expect(count, 'loopback guard: requests that tried to leave 127.0.0.1').toBe(0)
  if (problems.length > 0) throw problems[0]
})

// ---- the stories the world is built from (§3.15) ----

interface Cast {
  readonly L: TestStory
  readonly R: TestStory
  readonly T: TestStory
  readonly R2: TestStory
}

let cast: Promise<Cast> | null = null
const stories = (): Promise<Cast> =>
  (cast ??= (async () => {
    const list = await buildTestStories()
    const find = (id: string) => {
      const story = list.find((s) => s.storyId === id)
      if (story === undefined) throw new Error(`test setup: no ${id}`)
      return story
    }
    const R = find('river-stones')
    return {
      L: find('lantern-walk'),
      R,
      T: await fullyBoundStory(find('two-paths')),
      R2: await withPackage(R, StoryPackageV1.parse({ ...R.pkg, version: 2 })),
    }
  })())

const listed = async (set: FixtureSet, folder: string): Promise<readonly StoredObject[]> => {
  const result = await set.client.listContent(folder)
  if (result.kind !== 'listed') throw new Error(`test: ${folder} not listed`)
  return result.objects
}
const pathsOf = (objects: readonly StoredObject[]) => objects.map((o) => o.path)
const packagePath = (s: TestStory) => `packages/${s.storyId}/${s.packageSha256}.json`
const sortedByCodeUnits = (paths: readonly string[]) =>
  [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as unknown
const hex = (n: number) => n.toString(16).padStart(64, '0')
/**
 * How a call settles, so a soft check keeps its label when a mutant makes the call resolve (R1-TP-3:
 * `expect.soft(promise, label).rejects` drops the label when the promise resolves).
 */
const settled = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof TypeError ? 'TypeError' : 'another error'),
  )

/** Every content object's bytes and every master record the world names, as one comparable list. */
async function everyByte(set: FixtureSet, cast: Cast): Promise<string[]> {
  const out: string[] = []
  for (const object of await listed(set, '')) {
    const fields = classOfPath('content', object.path)
    const ref =
      fields?.kind === 'pointer'
        ? { kind: 'pointer' as const, mode: fields.fields.mode as 'production' | 'staging' }
        : fields?.kind === 'snapshot'
          ? { kind: 'snapshot' as const, seq: Number(fields.fields.seq) }
          : fields?.kind === 'package'
            ? {
                kind: 'package' as const,
                storyId: String(fields.fields.storyId),
                packageSha256: String(fields.fields.packageSha256),
              }
            : null
    if (ref === null) {
      // A medium is read through the world's public object read, which hashes its stored bytes.
      const answer = await set.site.object({
        path: object.path,
        bytes: object.size ?? -1,
        mime: String(fields?.fields.mime),
      })
      out.push(`${object.path} ${object.size} ${object.mimetype} ${answer.kind}`)
      continue
    }
    const read = await set.client.readContent(ref)
    out.push(`${object.path} ${read.kind === 'found' ? read.sha256 : read.kind}`)
  }
  for (const s of [cast.T, cast.R, cast.R2, cast.L]) {
    const approval = await set.client.readMaster({
      kind: 'approval',
      storyId: s.storyId,
      packageSha256: s.packageSha256,
    })
    out.push(`approval ${s.storyId} ${approval.kind === 'found' ? approval.sha256 : approval.kind}`)
    const waiver = await set.client.readMaster({
      kind: 'waiver',
      storyId: s.storyId,
      waiverSha256: s.waiverSha256,
    })
    out.push(`waiver ${s.storyId} ${waiver.kind === 'found' ? waiver.sha256 : waiver.kind}`)
  }
  return out
}

describe('fixture-store: the --fixtures world', () => {
  it(
    "T16-12 the fixture world: the real catalogue reader accepts it as production seq 3 and staging seq 4 per §3.15's table, approvals for T*, R and R2 only, waiver files per story, deterministic, fixtureFacts (A12)",
    TIMEOUT,
    async () => {
      const c = await stories()
      const set = await openFixtureSet()
      const all = await listed(set, '')
      const expected = 2 + 4 + 4 + c.T.media.length + c.R.media.length + c.L.media.length
      expect(
        [all.length, all.length > 0],
        'precondition: 2 pointers, 4 snapshots, 4 packages and the media of T*, R and L',
      ).toEqual([expected, true])

      // g1: the real reader, the table (MU16-77, MU16-78).
      const read = await readCatalogueState(set.client)
      expect.soft(read.ok, '(g1) readCatalogueState is ok').toBe(true)
      const state = read.ok ? read.state : null
      const approvalT = await approvalRecordOf(c.T, { on: ON })
      const approvalR = await approvalRecordOf(c.R, { on: ON })
      const view = (
        stories: readonly { storyId: string; packageSha256: string; approvalSha256?: string }[],
      ) => stories.map((e) => [e.storyId, e.packageSha256, e.approvalSha256 ?? null])
      expect
        .soft(
          [
            state?.production?.pointer.seq,
            state?.staging?.pointer.seq,
            state?.seqs,
            state?.orphans,
          ],
          '(g1) production seq 3, staging seq 4, seqs 1-4, no orphan',
        )
        .toEqual([3, 4, [1, 2, 3, 4], []])
      expect
        .soft(
          view(state?.production?.snapshot.stories ?? []),
          '(g1) production seq 3: [T*p, Rp], each with its approval',
        )
        .toEqual([
          ['two-paths', c.T.packageSha256, approvalT.sha256],
          ['river-stones', c.R.packageSha256, approvalR.sha256],
        ])
      expect
        .soft(view(state?.staging?.snapshot.stories ?? []), '(g1) staging seq 4: [T*p, R2, L]')
        .toEqual([
          ['two-paths', c.T.packageSha256, approvalT.sha256],
          ['river-stones', c.R2.packageSha256, null],
          ['lantern-walk', c.L.packageSha256, null],
        ])
      const snapshots = new Map<
        number,
        {
          featuredStoryId: unknown
          stories: { storyId: string; packageSha256: string; approvalSha256?: string }[]
        }
      >()
      for (const seq of [1, 2, 3, 4]) {
        const got = await set.client.readContent({ kind: 'snapshot', seq })
        if (got.kind === 'found') snapshots.set(seq, decode(got.bytes) as never)
      }
      expect
        .soft(
          [1, 2].map((seq) => view(snapshots.get(seq)?.stories ?? [])),
          '(g1) snapshots 1 and 2 hold their table stories',
        )
        .toEqual([
          [['two-paths', c.T.packageSha256, approvalT.sha256]],
          [
            ['two-paths', c.T.packageSha256, approvalT.sha256],
            ['river-stones', c.R.packageSha256, null],
          ],
        ])
      expect
        .soft(
          [1, 2, 3, 4].map((seq) => snapshots.get(seq)?.featuredStoryId),
          '(g1) featured null in all four',
        )
        .toEqual([null, null, null, null])

      // g2: masters (MU16-79).
      for (const s of [c.T, c.R, c.R2]) {
        const got = await set.client.readMaster({
          kind: 'approval',
          storyId: s.storyId,
          packageSha256: s.packageSha256,
        })
        const want = await approvalRecordOf(s, { on: ON })
        expect
          .soft(
            got.kind === 'found' && Buffer.from(got.bytes).equals(Buffer.from(want.bytes)),
            `(g2) the approval record of ${s.storyId} ${s.packageSha256.slice(0, 12)} is the testkit's`,
          )
          .toBe(true)
      }
      const noL = await set.client.readMaster({
        kind: 'approval',
        storyId: 'lantern-walk',
        packageSha256: c.L.packageSha256,
      })
      expect.soft(noL.kind, "(g2) L's approval is not-found").toBe('not-found')
      for (const s of [c.T, c.R, c.R2, c.L]) {
        const got = await set.client.readMaster({
          kind: 'waiver',
          storyId: s.storyId,
          waiverSha256: s.waiverSha256,
        })
        expect
          .soft(
            got.kind === 'found' && Buffer.from(got.bytes).equals(Buffer.from(s.waiverBytes)),
            `(g2) the waiver file of ${s.storyId} at waivers/<id>/<sha256>.json holds the testkit's bytes`,
          )
          .toBe(true)
      }

      // g3: deterministic across two module instances (MU16-80).
      vi.resetModules()
      const again = (await import('./fixture-store')) as typeof import('./fixture-store')
      const second = await again.openFixtureSet()
      expect.soft(pathsOf(await listed(second, '')), '(g3) equal listings').toEqual(pathsOf(all))
      expect
        .soft(await everyByte(second, c), '(g3) equal bytes per object')
        .toEqual(await everyByte(set, c))
      expect
        .soft(await again.fixtureFacts(), '(g3) equal fixtureFacts')
        .toEqual(await fixtureFacts())

      // g4: fixtureFacts (MU16-81).
      const facts = await fixtureFacts()
      expect.soft(facts, '(g4) the facts the runbook and the owner steps use').toEqual({
        approve: {
          storyId: 'lantern-walk',
          packagePrefix: c.L.packageSha256.slice(0, 12),
          answers: answersOf(c.L),
        },
        publish: { storyIds: 'river-stones' },
        feature: { storyId: 'two-paths' },
        rollback: { snapshot: '1' },
        unpublish: { storyId: 'river-stones' },
      })
      const values = [
        facts.approve.storyId,
        facts.approve.packagePrefix,
        ...Object.values(facts.approve.answers),
        facts.publish.storyIds,
        facts.feature.storyId,
        facts.rollback.snapshot,
        facts.unpublish.storyId,
      ]
      expect
        .soft(
          [values.length, values.every((v) => typeof v === 'string')],
          '(g4) 12 values, every one a string',
        )
        .toEqual([12, true])
    },
  )

  it(
    'T16-13 reads answer like the client, writers reject, live and site answer per verify-command (A12; L-F2)',
    TIMEOUT,
    async () => {
      const c = await stories()
      const set = await openFixtureSet()
      const all = await listed(set, '')
      expect(all.length, 'precondition: the world lists objects').toBeGreaterThan(0)

      // g1: the listing (MU16-82 unsorted, MU16-83 folder check removed).
      expect
        .soft(pathsOf(all), '(g1) every object, recursively, in UTF-16 code-unit order')
        .toEqual(sortedByCodeUnits(pathsOf(all)))
      expect
        .soft(
          ['catalogue/', 'packages/', 'media/'].every((prefix) =>
            all.some((o) => o.path.startsWith(prefix)),
          ),
          '(g1) the listing of "" reaches catalogue/, packages/ and media/',
        )
        .toBe(true)
      expect
        .soft(
          pathsOf(await listed(set, 'packages/river-stones/')),
          "(g1) packages/river-stones/: R's and R2's packages",
        )
        .toEqual(sortedByCodeUnits([packagePath(c.R), packagePath(c.R2)]))
      expect
        .soft(
          pathsOf(await listed(set, 'media/river-stones/')),
          "(g1) media/river-stones/: R's three media",
        )
        .toEqual(sortedByCodeUnits(c.R.media.map((m) => m.path)))
      expect
        .soft(
          pathsOf(await listed(set, 'catalogue/')),
          '(g1) catalogue/: two pointers, four snapshots',
        )
        .toEqual(
          sortedByCodeUnits([
            'catalogue/production.json',
            'catalogue/staging.json',
            ...[1, 2, 3, 4].map((seq) => `catalogue/snapshots/${seq}.json`),
          ]),
        )
      expect
        .soft(await listed(set, 'packages/no-such-story/'), '(g1) an empty folder lists []')
        .toEqual([])
      for (const folder of [
        'packages/river',
        'packages',
        '/packages/',
        'packages//',
        '../',
        './packages/',
        'packages\\x/',
        'packages/../',
        '%2e%2e/',
        'packages/./',
      ]) {
        expect
          .soft(
            await settled(set.client.listContent(folder)),
            `(g1) a TypeError for the folder ${JSON.stringify(folder)}`,
          )
          .toBe('TypeError')
      }

      // g2: the listing entry of R's package equals the loopback stub's for the same object (MU16-84).
      const stub = await startStorageStub({ apikey: FAKE_KEY })
      stubs.push(stub)
      const client = createStorageClient({
        supabaseUrl: stub.origin,
        secretKey: new Secret(FAKE_KEY),
      })
      const created = await client.create(
        { kind: 'package', storyId: 'river-stones', packageSha256: c.R.packageSha256 },
        c.R.packageBytes,
      )
      expect(created.kind, 'precondition: the real client created R’s package on the stub').toBe(
        'created',
      )
      const real = await client.listContent('packages/river-stones/')
      const realEntry = real.kind === 'listed' ? real.objects[0] : undefined
      const worldEntry = (await listed(set, 'packages/river-stones/')).find(
        (o) => o.path === packagePath(c.R),
      )
      expect
        .soft(
          [worldEntry?.path, worldEntry?.size, worldEntry?.mimetype, worldEntry?.cacheControl],
          "(g2) path, size, mimetype and cacheControl equal the stub's entry",
        )
        .toEqual([realEntry?.path, realEntry?.size, realEntry?.mimetype, realEntry?.cacheControl])
      expect
        .soft(typeof worldEntry?.updatedAt, '(g2) updatedAt of the same type')
        .toBe(typeof realEntry?.updatedAt)
      expect.soft(realEntry?.mimetype, '(g2) the stub listed a mimetype').toBe('application/json')

      // g3: reads (MU16-85).
      const pkgRef = {
        kind: 'package' as const,
        storyId: 'river-stones',
        packageSha256: c.R.packageSha256,
      }
      const first = await set.client.readContent(pkgRef)
      expect
        .soft(
          first.kind === 'found' && [
            Buffer.from(first.bytes).equals(Buffer.from(c.R.packageBytes)),
            first.size,
            first.sha256,
          ],
          "(g3) readContent: R's package bytes, size and sha256",
        )
        .toEqual([true, c.R.packageBytes.byteLength, c.R.packageSha256])
      if (first.kind === 'found') first.bytes.fill(0)
      const second = await set.client.readContent(pkgRef)
      expect
        .soft(
          second.kind === 'found' &&
            Buffer.from(second.bytes).equals(Buffer.from(c.R.packageBytes)),
          '(g3) a second read after mutating the first result is unchanged',
        )
        .toBe(true)
      const approvalR = await approvalRecordOf(c.R, { on: ON })
      const master = await set.client.readMaster({
        kind: 'approval',
        storyId: 'river-stones',
        packageSha256: c.R.packageSha256,
      })
      expect
        .soft(
          master.kind === 'found' && [master.size, master.sha256],
          "(g3) readMaster: R's approval record's size and sha256",
        )
        .toEqual([approvalR.bytes.byteLength, approvalR.sha256])
      if (master.kind === 'found') master.bytes.fill(0)
      const masterAgain = await set.client.readMaster({
        kind: 'approval',
        storyId: 'river-stones',
        packageSha256: c.R.packageSha256,
      })
      expect
        .soft(
          masterAgain.kind === 'found' &&
            Buffer.from(masterAgain.bytes).equals(Buffer.from(approvalR.bytes)),
          '(g3) a second master read after mutating the first is unchanged',
        )
        .toBe(true)
      expect
        .soft(
          (
            await set.client.readContent({
              kind: 'package',
              storyId: 'river-stones',
              packageSha256: hex(7),
            })
          ).kind,
          '(g3) not-found for an absent package',
        )
        .toBe('not-found')
      expect
        .soft(
          (
            await set.client.readMaster({
              kind: 'approval',
              storyId: 'lantern-walk',
              packageSha256: c.L.packageSha256,
            })
          ).kind,
          '(g3) not-found for an absent approval',
        )
        .toBe('not-found')
      const refused: [string, () => Promise<unknown>][] = [
        [
          'readContent River',
          () =>
            set.client.readContent({
              kind: 'package',
              storyId: 'River',
              packageSha256: hex(1),
            } as never),
        ],
        [
          'readContent a waiver ref',
          () =>
            set.client.readContent({
              kind: 'waiver',
              storyId: 'river-stones',
              waiverSha256: hex(1),
            } as never),
        ],
        [
          'readContent pointer x',
          () => set.client.readContent({ kind: 'pointer', mode: 'x' } as never),
        ],
        ['readContent seq 0', () => set.client.readContent({ kind: 'snapshot', seq: 0 })],
        [
          'readContent an extra key',
          () => set.client.readContent({ kind: 'snapshot', seq: 1, x: 1 } as never),
        ],
        [
          'readMaster a snapshot ref',
          () => set.client.readMaster({ kind: 'snapshot', seq: 1 } as never),
        ],
        [
          'readMaster a short sha',
          () =>
            set.client.readMaster({
              kind: 'approval',
              storyId: 'river-stones',
              packageSha256: 'abc',
            }),
        ],
      ]
      for (const [id, call] of refused) {
        expect.soft(await settled(call()), `(g3) a TypeError for ${id}`).toBe('TypeError')
      }

      // g4: the writers reject and change nothing (MU16-86).
      const before = await everyByte(set, c)
      const write: [string, () => Promise<unknown>][] = [
        [
          'create a snapshot',
          () => set.client.create({ kind: 'snapshot', seq: 5 }, new Uint8Array([1])),
        ],
        [
          'create an approval',
          () =>
            set.client.create(
              { kind: 'approval', storyId: 'lantern-walk', packageSha256: c.L.packageSha256 },
              new Uint8Array([1]),
            ),
        ],
        [
          'writePointer production',
          () => set.client.writePointer('production', new Uint8Array([1])),
        ],
        ['writePointer staging', () => set.client.writePointer('staging', new Uint8Array([1]))],
      ]
      for (const [id, call] of write) {
        await expect
          .soft(call(), `(g4) ${id} rejects with the read-only TypeError`)
          .rejects.toThrow(new TypeError('fixtures: read-only store'))
        await expect
          .soft(
            call().catch((e: unknown) => e instanceof TypeError),
            `(g4) ${id}: a TypeError`,
          )
          .resolves.toBe(true)
      }
      expect
        .soft(await everyByte(set, c), '(g4) the listing and every byte unchanged')
        .toEqual(before)

      // g5: live and site (MU16-87, MU16-154 to MU16-157).
      const s3 = await set.client.readContent({ kind: 'snapshot', seq: 3 })
      const s3sha = s3.kind === 'found' ? s3.sha256 : ''
      const wantBuild = {
        snapshotSha256: s3sha,
        featuredStoryId: null,
        stories: [c.T, c.R].map((s) => ({
          storyId: s.storyId,
          version: s.pkg.version,
          packageSha256: s.packageSha256,
        })),
        excluded: [],
      }
      for (const expectedSeq of [3, 5]) {
        expect
          .soft(
            await set.live(expectedSeq),
            `(g5) live(${expectedSeq}) answers seq 3 with snapshot 3's build`,
          )
          .toEqual({ kind: 'live', seq: 3, build: wantBuild })
      }
      expect
        .soft(await set.site.landing('two-paths', 'en'), '(g5) site.landing ok')
        .toEqual({ kind: 'ok' })
      const plan = planMediaHeads([{ pkg: c.R.pkg }], '')
      const heads = plan.ok ? plan.value.heads : []
      expect(heads.length, 'precondition: R has media heads').toBeGreaterThan(0)
      for (const head of heads) {
        expect
          .soft(
            await set.site.object({ path: head.path, bytes: head.bytes, mime: head.mime }),
            `(g5) site.object ok for ${head.path}`,
          )
          .toEqual({ kind: 'ok' })
      }
      const mp3 = heads.find((h) => h.mime === 'audio/mpeg')
      const target = {
        path: mp3?.path ?? '',
        bytes: mp3?.bytes ?? 0,
        sha256: String(classOfPath('content', mp3?.path ?? '')?.fields.sha256),
      }
      const start = Math.floor(target.bytes / 2)
      expect
        .soft(await set.site.range(target), '(g5) site.range answers the middle range verify asks')
        .toEqual({
          kind: 'ok',
          start,
          end: Math.min(target.bytes - 1, start + 1023),
          size: target.bytes,
        })
      // B16-implB-1: the world's object and range reads answer from its own bytes, as the public reads
      // would, so an object it does not hold as named is never ok.
      const head = heads[0]
      if (head !== undefined) {
        expect
          .soft(
            (await set.site.object({ path: head.path, bytes: head.bytes + 1, mime: head.mime }))
              .kind,
            '(g5) site.object refuses another length',
          )
          .toBe('failed')
        expect
          .soft(
            (
              await set.site.object({
                path: `media/river-stones/${hex(9)}-w768.webp`,
                bytes: head.bytes,
                mime: 'image/webp',
              })
            ).kind,
            '(g5) site.object refuses an object the world does not hold',
          )
          .toBe('failed')
      }
      expect
        .soft(
          (await set.site.range({ ...target, sha256: hex(3) })).kind,
          '(g5) site.range refuses another sha256',
        )
        .toBe('failed')
      expect
        .soft(await sha256Hex(new Uint8Array([1])), '(g5) control: the hash helper runs')
        .toMatch(/^[0-9a-f]{64}$/)
    },
  )
})

// ---- T16-14: the testkit writers are never named (A12, A23) ----

const WRITERS = ['writeStageInputs', 'writeAudioTree']

/** Identifiers and string, template and computed-key literal texts of a TypeScript source. */
function namesIn(text: string, file = 'sample.ts'): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const names: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) names.push(node.text)
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      names.push(node.text)
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      names.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}
const writerFindings = (text: string) =>
  namesIn(text).filter((name) => WRITERS.some((writer) => name.includes(writer)))

describe('fixture-store: the testkit writers', () => {
  it("T16-14 fixture-store.ts never names stage-testkit's two writers (A12, A23)", () => {
    const text = readFileSync(fileURLToPath(new URL('./fixture-store.ts', import.meta.url)), 'utf8')
    const names = namesIn(text, 'fixture-store.ts')
    expect(
      [text.length > 0, names.includes('openFixtureSet'), names.includes('fixtureFacts')],
      'precondition: fixture-store.ts was read and its identifiers include openFixtureSet and fixtureFacts',
    ).toEqual([true, true, true])
    // g1 (MU16-88).
    expect.soft(writerFindings(text), '(g1) neither writer named in fixture-store.ts').toEqual([])

    // g2: the scanner's own samples (MW16-26: identifiers only).
    const found = [
      "import { writeAudioTree as w } from './stage-testkit'",
      "k['writeStageInputs'](root, s)",
      'k[`writeAudioTree`](root, s)',
      'const { writeStageInputs } = k',
      "export { writeAudioTree } from './stage-testkit'",
      "const f = k['write' + 'x']; f('writeAudioTree')",
      "Reflect.get(k, 'writeStageInputs')",
      'const t = `${a}writeAudioTree${b}`',
    ]
    for (const sample of found) {
      expect.soft(writerFindings(sample).length, `(g2) a finding: ${sample}`).toBeGreaterThan(0)
    }
    for (const sample of [
      '// writeStageInputs and writeAudioTree are never called here',
      '/* writeAudioTree */ const x = 1',
      "const y = 'writeStage' // near miss",
    ]) {
      expect.soft(writerFindings(sample), `(g2) clean: ${sample}`).toEqual([])
    }
  })
})
