// The publisher's masters command (design migration-input/p1-step17-design.md §3.7, §3.14, §3.19,
// §3.20, §3.23, §5, D17-7, D17-14, D17-19, D17-20, D17-23, D17-25; P1-9a, Step 17): the create-only
// writer of the private image masters and media-log snapshots the binder laid out under
// migration-input/phase2/masters.
// - The report dir first (run-kit openReportDir). Then the root (D17-23): realPath(root) must equal
//   the resolved root through report.ts's foldFor (win32 folds as NTFS does; posix keeps case) and
//   be a local real path, else masters-root (exit 1, before any client).
// - The listing (TP17-9, CRIT-6, CRIT-12): the root holds only images/ and media-log/; images/ only
//   StoryId folders, each holding at least one file, every name an image master by classOfPath;
//   media-log/ only <date>-<sha12> folders, each holding exactly the media-log pair or exactly the
//   image log, no two with one sha12. Names are classified only through classOfPath. Each file is
//   read through readLocalFile under its class cap and passes masterBodyRule; nothing is planned
//   before every file passed. Zero objects is masters-empty, never masters-unchanged.
// - The lines: the classes line, then makePort (the one client) and one authenticated read per
//   object in full-path order (UTF-16 code units): not-found is new, found with equal bytes is
//   existing, anything else stops; then the plan line with the digests (plan-digest.ts).
//   `--expect-plan` is compared before any write, in a dry run too (plan-changed).
// - The commit (deadline MASTERS_DEADLINE_MS, checked before every request): each new object re-read
//   and re-hashed immediately before its create, created create-only, then read back by full hash.
// - Output only through deps.log and deps.error in report.ts's formats; the report holds masters
//   storage paths, counts and hashes only, never the root or the report dir. Imports node:path,
//   ./local-files, ./plan-digest, ./port, ./report, ./run-kit, ./storage-layout and src/core only
//   (fence FS4d): no node:fs, no console, no process.
import { join } from 'node:path'
import { sha256Hex } from '../../src/core/hashing'
import { DATE, isCalendarDate } from '../../src/core/package/approval'
import { StoryId } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { listLocalFolder, readLocalFile } from './local-files'
import { planDigests } from './plan-digest'
import { isStorageRefusal, type MastersPort } from './port'
import {
  exitForPhase,
  foldFor,
  formatMastersClasses,
  formatMastersDone,
  formatMastersObject,
  formatMastersPlan,
  formatStopped,
  internalName,
  isLocalRealPath,
  type ExitCode,
  type Phase,
  type ReportInput,
  type ReportMasters,
  type StopDetail,
} from './report'
import { Stop, failureCode, openReportDir, writeRunReport } from './run-kit'
import {
  classOfPath,
  masterBodyRule,
  targetOf,
  type MastersObjectRef,
  type Target,
} from './storage-layout'

/** The whole commit, measured on deps.now from its start (§3.7 step 5). */
export const MASTERS_DEADLINE_MS = 3_600_000
const RULESET = PANCHATANTRA_RULESET
/** A snapshot folder's form; its date must also be a calendar date (D17-14). */
const SNAPSHOT_FOLDER = /^([0-9]{4}-[0-9]{2}-[0-9]{2})-([a-f0-9]{12})$/
const MEDIA_LOG_PAIR = ['media-log.history.jsonl', 'media-log.json'] as const
const IMAGE_LOG_ALONE = ['image-log.json'] as const

/** What masters needs from the parsed arguments (the timeout goes to the client, in cli.ts). */
export interface MastersInput {
  /** The resolved --masters root (args.ts refused the device, network and unstorable forms). */
  readonly masters: string
  readonly dryRun: boolean
  readonly expectPlan: string | null
  readonly reportDir: string
  readonly reportDirGiven: boolean
}

export interface MastersDeps {
  readonly storyboardRoot: string
  /** The platform the run reports; win32 folds the root compare as NTFS does (D15-28). */
  readonly platform: string
  readonly now: () => Date
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  /** The real path of a local folder (cli.ts passes realpathSync.native). */
  readonly realPath: (path: string) => string
  /** Builds the client; called once, only after every local check passed. */
  readonly makePort: () => MastersPort
}

/** One local masters object, checked: its ref, target, bytes and hash. */
interface LocalObject {
  readonly path: string
  readonly segments: readonly string[]
  readonly ref: MastersObjectRef
  readonly target: Target
  readonly bytes: number
  readonly sha256: string
}

type ObjectState = 'new' | 'existing' | 'created'

const codeUnitOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const sameNames = (names: readonly string[], want: readonly string[]): boolean =>
  names.length === want.length && names.every((name, i) => name === want[i])

/** The masters command: local checks, the plan by reads, the dry run or the commit (§3.7). */
export async function runMasters(input: MastersInput, deps: MastersDeps): Promise<ExitCode> {
  const realDir = openReportDir('masters', input.reportDir, input.reportDirGiven, deps)
  if (realDir === null) return 2
  const startedAt = deps.now().toISOString()
  const mode = input.dryRun ? 'dry-run' : 'masters'
  let phase: Phase = 'local'
  let writes = 0
  let section: ReportMasters | null = null
  const states = new Map<string, ObjectState>()
  let objects: LocalObject[] = []
  let digests: { readonly plan: string; readonly set: string } | null = null

  const sectionNow = (): ReportMasters | null =>
    digests === null
      ? null
      : {
          plan: digests.plan,
          set: digests.set,
          objects: objects.map((object) => ({
            path: object.path,
            bytes: object.bytes,
            sha256: object.sha256,
            state: states.get(object.path) ?? 'new',
          })),
        }
  const finish = (code: string, at: Phase): ExitCode => {
    const exitCode = exitForPhase(code, at)
    section = sectionNow()
    const report: ReportInput = {
      command: 'masters',
      mode,
      startedAt,
      finishedAt: deps.now().toISOString(),
      outcome: code,
      exitCode,
      writes,
      uploaded: [],
      skipped: [],
      orphans: [],
      superseded: [],
      ruleSetRef: RULESET.ref,
      privateWordLists: 'not loaded',
      stories: [],
      masters: section,
    }
    if (writeRunReport('masters', realDir, report, input.reportDirGiven, deps)) return exitCode
    return writes === 0 ? 2 : exitCode
  }
  function stop(code: string, detail: StopDetail = {}, at: Phase = phase): never {
    throw new Stop(code, detail, at)
  }

  try {
    // The root (D17-23): its real path, folded, equals the resolved one and is local.
    const root = input.masters
    let real: string
    try {
      real = deps.realPath(root)
    } catch {
      return stop('masters-root')
    }
    const fold = foldFor(deps.platform)
    if (typeof real !== 'string' || !isLocalRealPath(real) || fold(real) !== fold(root)) {
      stop('masters-root')
    }

    // The listing (§3.7 step 2), then every file read and gated before any client exists.
    const listed = listTree(root, stop)
    objects = []
    for (const entry of listed.sort((a, b) => codeUnitOrder(a.path, b.path))) {
      const made = targetOf(entry.ref, 'create')
      if (!made.ok) stop('internal', { errorName: 'Error' })
      const target = made.value
      const read = readLocalFile(root, entry.segments, target.maxBytes)
      if (!read.ok) stop(read.code)
      if ((await masterBodyRule(target, read.bytes)) !== null) stop('masters-local-invalid')
      objects.push({
        path: entry.path,
        segments: entry.segments,
        ref: entry.ref,
        target,
        bytes: read.bytes.byteLength,
        sha256: await sha256Hex(read.bytes),
      })
    }
    if (objects.length === 0) stop('masters-empty')
    const imageMasters = objects.filter((object) => object.ref.kind === 'image-master').length
    deps.log(
      formatMastersClasses({ imageMaster: imageMasters, mediaLog: objects.length - imageMasters }),
    )

    // The plan (§3.7 step 3): one authenticated read per object.
    phase = 'plan'
    const port = deps.makePort()
    for (const object of objects) {
      const found = await port.readMaster(object.ref)
      if (found.kind === 'not-found') states.set(object.path, 'new')
      else if (found.kind === 'found' && found.sha256 === object.sha256) {
        states.set(object.path, 'existing')
      } else if (found.kind === 'found' || found.kind === 'hash-mismatch') {
        stop('master-exists-differs')
      } else if (found.kind === 'too-large') {
        // B17-implC-1: too-large keeps its commit-only exit (§5); a plan read past the cap is a
        // read that could not verify the object.
        stop('master-unverifiable')
      } else {
        stop(failureCode(found.kind))
      }
      deps.log(
        formatMastersObject({
          path: object.path,
          bytes: object.bytes,
          sha256: object.sha256,
          state: states.get(object.path) === 'existing' ? 'existing' : 'new',
        }),
      )
    }
    const fresh = objects.filter((object) => states.get(object.path) === 'new')
    digests = await planDigests(
      'masters',
      objects.map((object) => ({
        path: object.path,
        sha256: object.sha256,
        bytes: object.bytes,
        contentType: object.target.contentType ?? '',
        state: states.get(object.path) ?? 'new',
      })),
      { fixed: {}, variable: {} },
    )
    deps.log(
      formatMastersPlan({
        objects: objects.length,
        new: fresh.length,
        existing: objects.length - fresh.length,
        bytes: fresh.reduce((sum, object) => sum + object.bytes, 0),
        plan: digests.plan,
        set: digests.set,
      }),
    )
    if (input.expectPlan !== null && input.expectPlan !== digests.plan) stop('plan-changed')
    if (input.dryRun) return finish('dry-run', 'end')
    if (fresh.length === 0) return finish('masters-unchanged', 'end')

    // The commit (§3.7 step 5): exit 3 from here.
    phase = 'commit'
    const started = deps.now().getTime()
    const deadline = () => {
      if (deps.now().getTime() - started > MASTERS_DEADLINE_MS) stop('deadline')
    }
    let created = 0
    let existing = objects.length - fresh.length
    for (const object of fresh) {
      deadline()
      const local = readLocalFile(root, object.segments, object.target.maxBytes)
      if (
        !local.ok ||
        local.bytes.byteLength !== object.bytes ||
        (await sha256Hex(local.bytes)) !== object.sha256
      ) {
        stop('local-file-changed')
      }
      writes += 1
      const result = await port.create(object.ref, local.bytes)
      switch (result.kind) {
        case 'created': {
          deadline()
          const back = await port.readMaster(object.ref)
          if (back.kind === 'found' && back.sha256 === object.sha256) {
            created += 1
            states.set(object.path, 'created')
          } else if (back.kind === 'found' || back.kind === 'hash-mismatch') {
            stop('master-readback-differs')
          } else {
            stop('master-unverifiable')
          }
          break
        }
        case 'duplicate':
          if (result.stored === 'identical') {
            existing += 1
            states.set(object.path, 'existing')
          } else if (result.stored === 'different') {
            stop('master-exists-differs')
          } else {
            stop('master-unverifiable')
          }
          break
        case 'too-large':
        case 'mime-refused':
          stop(result.kind)
          break
        case 'unauthorized':
          stop('storage-unauthorized')
          break
        default:
          stop('upload-failed')
      }
    }
    deps.log(formatMastersDone({ created, existing }))
    return finish('masters-written', 'end')
  } catch (thrown) {
    if (thrown instanceof Stop) {
      deps.log(formatStopped('masters', thrown.code, thrown.detail))
      return finish(thrown.code, thrown.phase)
    }
    if (isStorageRefusal(thrown)) {
      deps.log(formatStopped('masters', 'client-refused', { refusal: thrown.message }))
      return finish('client-refused', phase)
    }
    deps.log(formatStopped('masters', 'internal', { errorName: internalName(thrown) }))
    return finish('internal', phase)
  }
}

/** One listed masters object before its read: its storage path, segments and ref. */
interface ListedObject {
  readonly path: string
  readonly segments: readonly string[]
  readonly ref: MastersObjectRef
}

/** True when `<root>/<segments>` lists as a folder (a link to one included; the read refuses it). */
function isFolder(root: string, segments: readonly string[]): boolean {
  return listLocalFolder(join(root, ...segments)).ok
}

/** The names of a folder that must list, or the stop for a folder that does not. */
function namesOf(
  root: string,
  segments: readonly string[],
  stop: (code: string) => never,
): readonly string[] {
  const listed = listLocalFolder(join(root, ...segments))
  if (!listed.ok) stop('local-file-not-regular')
  return listed.names
}

/**
 * The listing rules of §3.7 step 2 (TP17-9): every name classified through classOfPath; a name
 * outside the rules is masters-unknown-file, a snapshot folder outside the pair rule
 * media-log-folder-invalid. A folder that fails to list stops as local-file-not-regular.
 */
function listTree(root: string, stop: (code: string) => never): ListedObject[] {
  const found: ListedObject[] = []
  for (const top of namesOf(root, [], stop)) {
    if (top === 'images') {
      for (const storyId of namesOf(root, ['images'], stop)) {
        if (!StoryId.safeParse(storyId).success) stop('masters-unknown-file')
        const names = namesOf(root, ['images', storyId], stop)
        if (names.length === 0) stop('masters-unknown-file')
        for (const name of names) {
          const path = `images/${storyId}/${name}`
          const cls = classOfPath('masters', path)
          if (cls?.kind !== 'image-master') stop('masters-unknown-file')
          const ext = cls.fields.ext === 'jpg' ? 'jpg' : 'png'
          found.push({
            path,
            segments: ['images', storyId, name],
            ref: { kind: 'image-master', storyId, sha256: String(cls.fields.sha256), ext },
          })
        }
      }
    } else if (top === 'media-log') {
      const sha12s = new Set<string>()
      for (const folder of namesOf(root, ['media-log'], stop)) {
        const shape = SNAPSHOT_FOLDER.exec(folder)
        if (shape === null) stop('masters-unknown-file')
        const date = shape[1] ?? ''
        if (!DATE.test(date) || !isCalendarDate(date)) stop('media-log-folder-invalid')
        const sha12 = shape[2] ?? ''
        if (sha12s.has(sha12)) stop('media-log-folder-invalid')
        sha12s.add(sha12)
        const files: string[] = []
        for (const name of namesOf(root, ['media-log', folder], stop)) {
          if (isFolder(root, ['media-log', folder, name])) stop('media-log-folder-invalid')
          const path = `media-log/${folder}/${name}`
          const cls = classOfPath('masters', path)
          if (cls?.kind !== 'media-log') stop('masters-unknown-file')
          const file = String(cls.fields.file)
          files.push(file)
          found.push({
            path,
            segments: ['media-log', folder, name],
            ref: {
              kind: 'media-log',
              date: String(cls.fields.date),
              sha12: String(cls.fields.sha12),
              file:
                file === 'media-log.json' || file === 'media-log.history.jsonl'
                  ? file
                  : 'image-log.json',
            },
          })
        }
        files.sort(codeUnitOrder)
        if (!sameNames(files, MEDIA_LOG_PAIR) && !sameNames(files, IMAGE_LOG_ALONE)) {
          stop('media-log-folder-invalid')
        }
      }
    } else {
      stop('masters-unknown-file')
    }
  }
  return found
}
