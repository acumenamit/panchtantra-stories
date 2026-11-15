// pnpm migrate:waiver-keys (design p1-step8-design.md §2, §3.1 D9, §9 items 37, 38, 43; P1-2b), run
// on the owner's PC. For each of the 11 legacy stories of pt/, strict-parses the private waiver file
// storyboard/migration-input/waivers/<storyId>.json (git-ignored) and derives its public match keys
// with deriveWaiverKeys, the matcher the build uses. Writes tools/migrate/legacy-waiver-keys.json as
// JCS bytes: a CI test fixture and drift anchor that the build never reads. Refuses a missing story,
// another rule set, a duplicate key and a record for X000, S001 or A001. Prints counts only: no
// message ever quotes a waiver file's basis, notes, ruleId, measured, limit,
// measuredOnPackageSha256, recordedOn or recordedBy.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { isEntryPoint } from '../../scripts/load-content'
import { jcsBytes } from '../../src/core/hashing'
import { WaiverKeys } from '../../src/core/package/catalogue'
import { StoryId } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import { WaiverFile, deriveWaiverKeys } from '../../src/core/validator/waivers'
import { loadLegacyStories } from './load-legacy'

/** Fixed text (design §2, §9 item 43), never copied from a waiver file. */
export const LEGACY_WAIVER_KEYS_NOTE =
  'Derived match keys of the legacy waivers (P1 D9); written by pnpm migrate:waiver-keys; the build never reads this file'

/** The committed keys file: one snapshot-shaped waiver block per legacy story. */
export const LegacyWaiverKeysFile = z.strictObject({
  schemaVersion: z.literal('1.0'),
  note: z.literal(LEGACY_WAIVER_KEYS_NOTE),
  stories: z.array(z.strictObject({ storyId: StoryId, waivers: WaiverKeys })),
})
export type LegacyWaiverKeysFile = z.infer<typeof LegacyWaiverKeysFile>

export interface LegacyWaiverKeys {
  readonly value: LegacyWaiverKeysFile
  /** The exact bytes to write (RFC 8785 JCS, no trailing newline). */
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly stories: number
  readonly keys: number
  readonly storiesWithoutKeys: number
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Derives the keys file from `<waiversDir>/<storyId>.json` for exactly the given stories, sorted by
 * storyId. Throws on the first refusal; messages name only story, check and node ids, locales,
 * schema paths and issue codes.
 */
export function buildLegacyWaiverKeys(
  waiversDir: string,
  storyIds: readonly string[],
): LegacyWaiverKeys {
  const ids = [...storyIds].sort()
  const stories: LegacyWaiverKeysFile['stories'] = []
  for (const [i, storyId] of ids.entries()) {
    if (!StoryId.safeParse(storyId).success) throw new Error(`invalid story id at position ${i}`)
    if (ids[i - 1] === storyId) throw new Error(`story ${storyId} is listed twice`)
    const path = join(waiversDir, `${storyId}.json`)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`missing waiver file for story ${storyId} (waivers/${storyId}.json)`)
    }
    const bytes = readFileSync(path)
    let json: unknown
    try {
      json = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new Error(`waiver file for ${storyId} is not valid JSON`)
    }
    const parsed = WaiverFile.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)'
      throw new Error(
        `waiver file for ${storyId} failed strict parse at ${where} (${issue?.code ?? 'unknown'})`,
      )
    }
    const file = parsed.data
    if (file.storyId !== storyId) {
      throw new Error(`waiver file for ${storyId} names story ${file.storyId}`)
    }
    if (file.ruleSetRef !== PANCHATANTRA_RULESET.ref) {
      throw new Error(
        `waiver file for ${storyId} was recorded for another rule set; this tool derives keys for ${PANCHATANTRA_RULESET.ref}`,
      )
    }
    const block = WaiverKeys.safeParse(deriveWaiverKeys(file, sha256Of(bytes)))
    if (!block.success) {
      const issue = block.error.issues[0]
      const where = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)'
      throw new Error(`waiver keys for ${storyId} fail the snapshot schema at ${where}`)
    }
    stories.push({ storyId, waivers: block.data })
  }
  const value = LegacyWaiverKeysFile.parse({
    schemaVersion: '1.0',
    note: LEGACY_WAIVER_KEYS_NOTE,
    stories,
  })
  return {
    value,
    bytes: jcsBytes(value),
    stories: stories.length,
    keys: stories.reduce((n, s) => n + s.waivers.keys.length, 0),
    storiesWithoutKeys: stories.filter((s) => s.waivers.keys.length === 0).length,
  }
}

function main(): number {
  const here = dirname(fileURLToPath(import.meta.url))
  const storyboardRoot = resolve(here, '../..')
  const storyIds = loadLegacyStories(resolve(storyboardRoot, '../pt/src/stories')).map(
    (l) => l.story.id,
  )
  const built = buildLegacyWaiverKeys(join(storyboardRoot, 'migration-input/waivers'), storyIds)
  writeFileSync(join(here, 'legacy-waiver-keys.json'), built.bytes)
  console.log(
    `waiver keys: ${built.stories} stories, ${built.keys} keys, ${built.storiesWithoutKeys} with none; wrote tools/migrate/legacy-waiver-keys.json (${built.bytes.length} bytes)`,
  )
  return 0
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  try {
    process.exit(main())
  } catch (error) {
    console.error(`waiver keys: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exit(1)
  }
}
