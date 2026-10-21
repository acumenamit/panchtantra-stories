// Phase-1 migration CLI (M1 + M4), run on the owner's PC:  pnpm migrate:convert [--write-manifest]
// Reads pt/ read-only; writes only to storyboard/migration-input/ (gitignored), plus the committed
// manifest when --write-manifest is given. Exits non-zero on any parse failure or text diff.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toGraph } from '../../src/core/engine'
import { jcsBytes, sha256Hex } from '../../src/core/hashing'
import { convertLegacyStory } from './convert'
import { compareStrings } from './equality'
import { loadLegacyStories, sha256OfBytes } from './load-legacy'
import { allEndingPaths } from './paths'

const here = dirname(fileURLToPath(import.meta.url))
const storyboardRoot = resolve(here, '../..')
const repoRoot = resolve(storyboardRoot, '..')
const storiesDir = join(repoRoot, 'pt/src/stories')
const outDir = join(storyboardRoot, 'migration-input')
const manifestPath = join(here, 'legacy-manifest.json')

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out[relative(repoRoot, p).replaceAll('\\', '/')] = sha256OfBytes(readFileSync(p))
    }
  }
  walk(dir)
  return out
}

async function main(): Promise<number> {
  const writeManifest = process.argv.includes('--write-manifest')
  const loaded = loadLegacyStories(storiesDir)

  const sourceHashes = {
    stories: Object.fromEntries(loaded.map((l) => [`pt/src/stories/${l.file}`, l.sourceSha256])),
    images: hashTree(join(repoRoot, 'pt/public/images')),
    audio: hashTree(join(repoRoot, 'pt/public/audio')),
  }

  const totals = { stories: 0, nodes: 0, choices: 0, endings: 0, goldenPaths: 0 }
  const strings = { en: 0, hi: 0 }
  const perStory = []
  let diffCount = 0

  mkdirSync(join(outDir, 'packages'), { recursive: true })
  mkdirSync(join(outDir, 'reports'), { recursive: true })

  for (const { file, story } of loaded) {
    const pkg = convertLegacyStory(story)
    const eq = compareStrings(story, pkg)
    const bytes = jcsBytes(pkg)
    const packageSha256 = await sha256Hex(bytes)
    writeFileSync(join(outDir, 'packages', `${pkg.storyId}.phase1.json`), bytes)
    const paths = allEndingPaths(toGraph(pkg)).length
    const choices = pkg.nodes.reduce((n, x) => n + (x.type === 'ending' ? 0 : x.choices.length), 0)
    const endings = pkg.nodes.filter((x) => x.type === 'ending').length
    totals.stories++
    totals.nodes += pkg.nodes.length
    totals.choices += choices
    totals.endings += endings
    totals.goldenPaths += paths
    strings.en += eq.stringsCompared.en
    strings.hi += eq.stringsCompared.hi
    diffCount += eq.diffs.length
    perStory.push({
      file,
      storyId: pkg.storyId,
      packageSha256,
      nodes: pkg.nodes.length,
      choices,
      endings,
      paths,
      diffs: eq.diffs,
    })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'pt/ working tree (owner-confirmed, M1)',
    totals,
    stringsComparedPerLocale: strings,
    textDiffs: diffCount,
    stories: perStory,
  }
  writeFileSync(
    join(outDir, 'reports', 'convert-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  writeFileSync(
    join(outDir, 'reports', 'source-hashes.json'),
    JSON.stringify(sourceHashes, null, 2) + '\n',
  )

  if (writeManifest) {
    const manifest = {
      note: 'Frozen legacy source (M1) and expected phase-1 conversion totals. Checked by tools/migrate/migrate.test.ts.',
      sourceFiles: sourceHashes.stories,
      totals,
      stringsComparedPerLocale: strings,
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }

  console.log(
    `stories ${totals.stories}, nodes ${totals.nodes}, choices ${totals.choices}, endings ${totals.endings}`,
  )
  console.log(
    `golden paths ${totals.goldenPaths}; strings compared en ${strings.en}, hi ${strings.hi}; text diffs ${diffCount}`,
  )
  console.log(
    `source hashes: ${Object.keys(sourceHashes.stories).length} story files, ${Object.keys(sourceHashes.images).length} images, ${Object.keys(sourceHashes.audio).length} audio files`,
  )
  console.log(
    `wrote ${relative(repoRoot, outDir)}/packages (${totals.stories} files) and reports/${writeManifest ? ' + manifest' : ''}`,
  )
  return diffCount === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
