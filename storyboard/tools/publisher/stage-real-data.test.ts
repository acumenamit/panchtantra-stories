// Step 14 (P1-8c) PC-only real-data check (design migration-input/p1-step14-design.md D14-3, D14-4,
// A28; test plan §14.9: T14-73). The 11 private waiver files of migration-input/waivers
// (git-ignored, present on the owner's PC only) pass the local part of D14-3 and the R24 rule, and
// the blocks derived from them equal the committed CI copy (tools/migrate/legacy-waiver-keys.json).
// Skips on CI, printing why. Privacy (rules-block): only derived blocks are compared, as JCS text
// and by a boolean, so a failure prints story ids and counts, never a waiver file's fields.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { toJcs } from '../../src/core/hashing'
import { LegacyWaiverKeysFile } from '../migrate/waiver-keys-cli'
import { deriveWaiverBlock } from './story-checks'

const STORYBOARD = fileURLToPath(new URL('../../', import.meta.url))
const WAIVERS = join(STORYBOARD, 'migration-input', 'waivers')
const CI_COPY = join(STORYBOARD, 'tools', 'migrate', 'legacy-waiver-keys.json')
const present = existsSync(WAIVERS)
if (!present) console.log('skipped: migration-input/waivers absent (CI)')

describe('real waiver files (PC only)', () => {
  it.skipIf(!present)(
    'T14-73 PC-only: the 11 local waiver files pass the local checks and derive the committed CI blocks (A28)',
    async () => {
      const names = readdirSync(WAIVERS)
        .filter((name) => name.endsWith('.json'))
        .sort()
      expect(names.length, 'precondition: 11 waiver files').toBe(11)
      const ci = LegacyWaiverKeysFile.safeParse(JSON.parse(readFileSync(CI_COPY, 'utf8')))
      expect(ci.success, 'precondition: the CI copy parses').toBe(true)
      const blocks = ci.success ? ci.data.stories : []
      expect(blocks.length, 'precondition: 11 stories in the CI copy').toBe(11)
      expect(
        blocks.reduce((n, s) => n + s.waivers.keys.length, 0),
        'precondition: 41 keys in the CI copy',
      ).toBe(41)
      for (const name of names) {
        const storyId = name.slice(0, -'.json'.length)
        const bytes = new Uint8Array(readFileSync(join(WAIVERS, name)))
        const derived = await deriveWaiverBlock(storyId, bytes)
        expect
          .soft(derived.ok ? 'ok' : derived.code, `(g1) ${storyId}: the local checks and R24`)
          .toBe('ok')
        const want = blocks.find((s) => s.storyId === storyId)?.waivers
        const same = derived.ok && want !== undefined && toJcs(derived.waiver.block) === toJcs(want)
        expect.soft(same, `(g2) ${storyId}: the derived block equals the CI copy`).toBe(true)
      }
    },
  )
})
