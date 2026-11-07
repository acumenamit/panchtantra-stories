import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')
const PackageScripts = z.object({ scripts: z.record(z.string(), z.string()) })

/** Each file a script runs with tsx: "tsx scripts/load-content.ts && next build" -> scripts/load-content.ts. */
function tsxTargets(scripts: Readonly<Record<string, string>>): [string, string][] {
  return Object.entries(scripts).flatMap(([name, command]) =>
    [...command.matchAll(/(?:^|[\s;&|])tsx\s+(\S+\.ts)(?=\s|$)/g)].map(
      (match): [string, string] => [name, match[1]!],
    ),
  )
}

describe('package.json scripts', () => {
  it('finds every tsx target in a command', () => {
    expect(
      tsxTargets({
        build: 'tsx scripts/load-content.ts && next build',
        plan: 'tsx tools/narration/cli.ts plan',
        lint: 'eslint .',
      }),
    ).toEqual([
      ['build', 'scripts/load-content.ts'],
      ['plan', 'tools/narration/cli.ts'],
    ])
  })

  it('run only tsx files that exist, so a script left behind by a cleanup fails the tests', () => {
    const { scripts } = PackageScripts.parse(
      JSON.parse(readFileSync(join(storyboard, 'package.json'), 'utf8')),
    )
    const targets = tsxTargets(scripts)
    expect(targets.map(([name]) => name)).toContain('build')
    expect(targets.filter(([, file]) => !existsSync(join(storyboard, file)))).toEqual([])
  })
})
