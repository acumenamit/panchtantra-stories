// Vercel deploy hook trigger for `publish` (spec §3.2, §8). The hook URL is a credential, so it is
// passed as a Secret and never appears in a log line, a result or an error.
// - POST, with `buildCache=false` set through the URL API (spec §3.2 [REC]).
// - Any 2xx answer that carries `job.id` counts as triggered. Nothing is retried: Vercel cancels
//   earlier builds for the same version, so a blind retry could cancel the build it just started.
// - Logs only the job id and createdAt.
import { z } from 'zod'
import type { Secret } from './env'
import { checkServiceUrl, describeNetworkError, parseJsonBytes, readCapped } from './http'

export const HOOK_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 64 * 1024

const HookResponse = z.object({
  job: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    createdAt: z.unknown().optional(),
  }),
})

export type HookResult =
  | {
      readonly kind: 'triggered'
      readonly status: number
      readonly jobId: string
      /** Milliseconds since the epoch, as Vercel reports it; null when absent or not a number. */
      readonly createdAt: number | null
    }
  | { readonly kind: 'failed'; readonly status: number | null; readonly reason: string }

export interface HookOptions {
  readonly hookUrl: Secret
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  readonly log?: (line: string) => void
}

/** The hook URL with buildCache=false (replacing any buildCache value already present). */
export function hookRequestUrl(hookUrl: Secret): URL {
  let url: URL
  try {
    url = new URL(hookUrl.reveal())
  } catch {
    throw new TypeError('deploy hook URL is not a valid URL')
  }
  checkServiceUrl(url, 'deploy hook URL')
  url.searchParams.set('buildCache', 'false')
  return url
}

/** Reads the job from a hook response body. */
export function parseHookJob(
  status: number,
  body: unknown,
): Extract<HookResult, { kind: 'triggered' }> | null {
  const parsed = HookResponse.safeParse(body)
  if (!parsed.success) return null
  const { id, createdAt } = parsed.data.job
  const ms = typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt >= 0
  return { kind: 'triggered', status, jobId: id, createdAt: ms ? createdAt : null }
}

export async function triggerDeployHook(options: HookOptions): Promise<HookResult> {
  const url = hookRequestUrl(options.hookUrl)
  const log = options.log ?? ((line: string) => console.log(line))
  const result = await postHook(
    url,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? HOOK_TIMEOUT_MS,
  )
  if (result.kind === 'triggered') {
    const created = result.createdAt === null ? '-' : new Date(result.createdAt).toISOString()
    log(`hook: job=${result.jobId} createdAt=${created}`)
  } else {
    log(`hook: failed status=${result.status ?? '-'} reason=${result.reason}`)
  }
  return result
}

async function postHook(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<HookResult> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { kind: 'failed', status: null, reason: `network ${describeNetworkError(error)}` }
  }
  const { status } = response
  const bytes = await readCapped(response, MAX_RESPONSE_BYTES).catch(() => null)
  if (status < 200 || status >= 300) return { kind: 'failed', status, reason: 'non-2xx status' }
  if (!bytes) return { kind: 'failed', status, reason: 'response body unreadable or too large' }
  const parsed = parseJsonBytes(bytes)
  const job = parsed.ok ? parseHookJob(status, parsed.value) : null
  return job ?? { kind: 'failed', status, reason: 'response has no usable job.id' }
}
