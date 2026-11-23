// Recipe @2 workflow on the owner's PC (generation itself runs on a Colab GPU). Logic: parler-pipeline.ts.
//   pnpm narration:export
//       -> migration-input/narration/parler-plan.json (every file; upload it to the Colab generator notebook)
//   pnpm narration:export --only story/node.locale,... --seed N
//       -> remake: saves the new seed, rewrites parler-plan.json and writes parler-plan.redo-<stamp>.json to upload
//          (commas, no spaces; N from 0 to 4294967295 and different from the file's current seed)
//   pnpm narration:export --keep-plan-seeds
//       -> when seed-overrides.json was lost or restored from an old backup: keep the seeds parler-plan.json uses
//   pnpm narration:ingest <folder>
//       -> checks the Colab output folder (manifest.jsonl + <story>/<node>.<locale>.mp3), copies valid files to
//          migration-input/audio/, updates the private media log and writes a QA report with a listening list.
//          (one folder; put the path in quotes: PowerShell splits a path at spaces and brackets)
//   pnpm narration:listened story/node.locale,... | --all
//       -> marks remade files as heard, so they leave the listening list
// Reads and writes only under storyboard/migration-input/ (gitignored). No network.
// P1 Step 17 (design migration-input/p1-step17-design.md §3.17, D17-17): the recorded text corrections
// (tools/migrate/text-corrections.json, read from this repository even with NARRATION_ROOT) are loaded once and
// applied to the packages export and ingest read; a file that cannot be loaded stops every command with exit 2
// and `text-corrections.json: <code>`.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTextCorrections } from '../migrate/text-corrections'
import { exportPlan, ingest, markListened } from './parler-pipeline'

const here = dirname(fileURLToPath(import.meta.url))
// NARRATION_ROOT lets a smoke test run against a scratch copy instead of the real storyboard/ folder.
const root = process.env.NARRATION_ROOT
  ? resolve(process.env.NARRATION_ROOT)
  : resolve(here, '../..')

async function main(): Promise<number> {
  const [mode, ...rest] = process.argv.slice(2)
  const args = rest[0] === '--' ? rest.slice(1) : rest // pnpm passes a leading "--" through
  const loaded = loadTextCorrections()
  if (!loaded.ok) throw new Error(`text-corrections.json: ${loaded.code}`)
  const opts = {
    now: new Date(),
    log: (line: string) => console.log(line),
    corrections: loaded.records,
  }
  if (mode === 'export') return exportPlan(root, args, opts)
  if (mode === 'ingest') {
    if (args.length > 1)
      throw new Error(
        `ingest takes one folder, got ${args.length} arguments: put the path in quotes (PowerShell splits a path at spaces and brackets)`,
      )
    return ingest(root, args[0], opts)
  }
  if (mode === 'listened') return markListened(root, args, opts)
  throw new Error(
    'Usage: parler-cli.ts export [--only k1,k2 --seed N] | ingest "<folder>" | listened k1,k2|--all',
  )
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
