// P0-13 THROWAWAY: removed at cleanup
// Spike S-1 readout: the build-info.json that scripts/load-content.ts wrote to .content/ before
// `next build`. The page is prerendered, so its HTML proves which seq a deployment was built with.
// Without loaded content (CI, e2e, a local build with no CONTENT_SOURCE) it says "content not loaded".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import { BuildInfo } from '@/core/content/build-info'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Spike S-1',
  robots: { index: false, follow: false },
}

type Readout =
  | { readonly state: 'loaded'; readonly info: BuildInfo }
  | { readonly state: 'not-loaded' }
  | { readonly state: 'invalid'; readonly reason: string }

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** Runs once, at build time. */
function readBuildInfo(): Readout {
  let text: string
  try {
    text = readFileSync(join(process.cwd(), '.content', 'build-info.json'), 'utf8')
  } catch (error) {
    return isMissingFile(error)
      ? { state: 'not-loaded' }
      : { state: 'invalid', reason: 'unreadable' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { state: 'invalid', reason: 'not JSON' }
  }
  const parsed = BuildInfo.safeParse(raw)
  return parsed.success
    ? { state: 'loaded', info: parsed.data }
    : { state: 'invalid', reason: 'failed strict parse' }
}

/** The six S-1 fields, each shown as text and as a data- attribute with the same value. */
function fields(
  info: BuildInfo,
): readonly (readonly [label: string, attribute: string, value: string])[] {
  const show = (value: string | number | null) => (value === null ? 'null' : String(value))
  return [
    ['seq', 'data-seq', show(info.seq)],
    ['snapshot sha256', 'data-snapshot-sha256', show(info.snapshotSha256)],
    ['appVersion', 'data-app-version', show(info.appVersion)],
    ['deploymentId', 'data-deployment-id', show(info.deploymentId)],
    ['deploymentUrl', 'data-deployment-url', show(info.deploymentUrl)],
    ['builtAt', 'data-built-at', show(info.builtAt)],
  ]
}

export default function SpikeS1Page() {
  const readout = readBuildInfo()
  return (
    <main>
      <h1>Spike S-1</h1>
      {readout.state === 'loaded' ? (
        <dl
          id="build-info"
          data-state="loaded"
          {...Object.fromEntries(
            fields(readout.info).map(([, attribute, value]) => [attribute, value]),
          )}
        >
          {fields(readout.info).map(([label, , value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : readout.state === 'not-loaded' ? (
        <p id="build-info" data-state="not-loaded">
          content not loaded
        </p>
      ) : (
        <p id="build-info" data-state="invalid">
          build-info invalid: {readout.reason}
        </p>
      )}
    </main>
  )
}
