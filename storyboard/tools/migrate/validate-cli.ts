// P0-8 (M5): validate the phase-1 packages and draft waivers, on the owner's PC.
//   pnpm migrate:validate
// Reads storyboard/migration-input/packages and, if present, storyboard/.rules-private/<ref>.private.json.
// Writes only to storyboard/migration-input/ (gitignored): reports/validation-report.json and
// waivers/<storyId>.json (DRAFTS for the owner; they move to the private 'masters' bucket per NI-3).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { StoryPackageV1 } from '../../src/core/package/v1'
import { PANCHATANTRA_RULESET } from '../../src/core/rules/panchatantra'
import type { PrivateRuleData } from '../../src/core/rules/types'
import { draftWaivers, validatePackage } from '../../src/core/validator'

const here = dirname(fileURLToPath(import.meta.url))
const storyboardRoot = resolve(here, '../..')
const inDir = join(storyboardRoot, 'migration-input/packages')
const outDir = join(storyboardRoot, 'migration-input')
const privatePath = join(
  storyboardRoot,
  '.rules-private',
  `${PANCHATANTRA_RULESET.ref}.private.json`,
)

const PrivateFile = z.object({
  ref: z.string(),
  idioms: z.array(z.string()),
  anachronismKeywords: z.array(z.string()),
  sanskritNeverCall: z.record(z.string(), z.array(z.string())),
})

async function main(): Promise<number> {
  const privateData: PrivateRuleData | undefined = existsSync(privatePath)
    ? PrivateFile.parse(JSON.parse(readFileSync(privatePath, 'utf8')))
    : undefined
  const today = new Date().toISOString().slice(0, 10)
  mkdirSync(join(outDir, 'reports'), { recursive: true })
  mkdirSync(join(outDir, 'waivers'), { recursive: true })

  const stories = []
  let errorRecords = 0
  const errorNodes = new Set<string>()
  for (const f of readdirSync(inDir)
    .filter((x) => x.endsWith('.phase1.json'))
    .sort()) {
    const bytes = readFileSync(join(inDir, f))
    const pkg = StoryPackageV1.parse(JSON.parse(bytes.toString('utf8')))
    const packageSha256 = await sha256Hex(jcsBytes(pkg))
    const report = validatePackage(pkg, {
      ruleSet: PANCHATANTRA_RULESET,
      ...(privateData ? { privateData } : {}),
    })
    const waivers = await draftWaivers(report, pkg, {
      basis: 'requirements.md legacy waiver decision (REQ:64)',
      recordedOn: today,
      packageSha256,
    })
    writeFileSync(
      join(outDir, 'waivers', `${pkg.storyId}.json`),
      JSON.stringify(waivers, null, 2) + '\n',
    )
    const errors = report.findings.filter((x) => x.severity === 'error')
    errorRecords += errors.length
    errors.forEach((x) => errorNodes.add(`${pkg.storyId}/${x.nodeId}`))
    const count = (sev: string) => report.findings.filter((x) => x.severity === sev).length
    stories.push({
      storyId: pkg.storyId,
      packageSha256,
      errors: errors.length,
      warnings: count('warn'),
      info: count('info'),
      skipped: report.skipped,
      findings: report.findings,
    })
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    ruleSetRef: PANCHATANTRA_RULESET.ref,
    ruleSetStatus: PANCHATANTRA_RULESET.status,
    privateWordLists: privateData ? 'loaded' : 'not loaded (E016-E018 skipped)',
    errorRecords,
    errorNodes: errorNodes.size,
    stories,
  }
  writeFileSync(
    join(outDir, 'reports', 'validation-report.json'),
    JSON.stringify(summary, null, 2) + '\n',
  )

  console.log(
    `rule set ${summary.ruleSetRef} (${summary.ruleSetStatus}); private word lists ${summary.privateWordLists}`,
  )
  for (const s of stories) {
    const warnIds = [
      ...new Set(s.findings.filter((x) => x.severity === 'warn').map((x) => x.checkId)),
    ].join(',')
    console.log(
      `${s.storyId.padEnd(24)} errors ${String(s.errors).padStart(2)}  warnings ${String(s.warnings).padStart(3)} [${warnIds}]  info ${s.info}`,
    )
  }
  console.log(
    `total: ${errorRecords} error records on ${errorNodes.size} nodes -> draft waivers in migration-input/waivers/`,
  )
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
