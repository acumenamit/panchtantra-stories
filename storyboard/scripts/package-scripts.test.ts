import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BUILD_STEPS, NEXT_BUILD_ARGS } from './preview-staging'

const storyboard = join(dirname(fileURLToPath(import.meta.url)), '..')
const PackageScripts = z.object({ scripts: z.record(z.string(), z.string()) })
const readScripts = () =>
  PackageScripts.parse(JSON.parse(readFileSync(join(storyboard, 'package.json'), 'utf8'))).scripts

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

  it('ends build with the post-build check, so it also runs inside the Vercel build (P1-1c)', () => {
    const { scripts } = PackageScripts.parse(
      JSON.parse(readFileSync(join(storyboard, 'package.json'), 'utf8')),
    )
    // design p1-step7-design.md §5.7 item 2, §7 item 3: the loader, then next build, then
    // check-build, chained with && so a failed check fails the build.
    expect(scripts.build).toBe(
      'tsx scripts/load-content.ts && next build && tsx scripts/check-build.ts',
    )
  })

  // P1-2c (design p1-step9-design.md §3.6 rows 22-24, §6.1, §10.1): the owner's LAN preview is a
  // tsx wrapper (inline env fails under Windows cmd; no cross-env package), and it runs exactly the
  // three steps of build, so the two cannot drift apart.
  it('runs preview:staging through its tsx wrapper (P1-2c)', () => {
    expect(readScripts()['preview:staging']).toBe('tsx scripts/preview-staging.ts')
  })

  it("preview:staging's BUILD_STEPS are build's steps, in order (P1-2c drift guard)", () => {
    const build = readScripts().build ?? ''
    expect(build.split(' && ')).toEqual([...BUILD_STEPS])
    expect(BUILD_STEPS).toHaveLength(3)
    // runStagingSteps spawns next with exactly the arguments of build's next step.
    expect(['next', ...NEXT_BUILD_ARGS].join(' ')).toBe(build.split(' && ')[1])
  })
})
