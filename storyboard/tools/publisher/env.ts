// Publisher configuration (spec §3.4, §3.5). On this PC the values come from storyboard/.env.local
// (gitignored); in GitHub Actions they come from secrets in the process environment.
// Checks shapes only. No message ever contains a value, and the two credentials (the Supabase secret
// key and the deploy hook URL, which is itself a credential) come back wrapped in Secret.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** storyboard/.env.local */
export const ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.local')

export const PUBLISHER_ENV_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'VERCEL_DEPLOY_HOOK_PRODUCTION',
  'NEXT_PUBLIC_SITE_URL',
] as const

export type PublisherEnvName = (typeof PUBLISHER_ENV_NAMES)[number]
export type Env = Readonly<Record<string, string | undefined>>
export type EnvResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

const REDACTED = '[redacted]'

/** A credential that hides itself from String(), template strings, JSON.stringify and util.inspect. */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** The raw value, for the one place that must send it (a request header or the request URL). */
  reveal(): string {
    return this.#value
  }

  toString(): string {
    return REDACTED
  }

  toJSON(): string {
    return REDACTED
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED
  }
}

/**
 * Loads the file into process.env with Node's loadEnvFile. A variable already set in the process
 * environment keeps its value (Node's precedence). Returns false when the file does not exist.
 */
export function loadEnvFile(file: string = ENV_FILE): boolean {
  if (!existsSync(file)) return false
  process.loadEnvFile(file)
  return true
}

const ok = <T>(value: T): EnvResult<T> => ({ ok: true, value })
const fail = <T>(reason: string): EnvResult<T> => ({ ok: false, reason })

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** True when the URL has nothing beyond scheme and host: no credentials, port, path, query or fragment. */
function isBareOrigin(url: URL): boolean {
  return (
    !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
  )
}

// A Supabase project ref is 20 lowercase characters (for example the project in plan O3).
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/

/** SUPABASE_URL: exactly https://<project-ref>.supabase.co (one trailing slash allowed). */
export function readSupabaseUrl(env: Env): EnvResult<URL> {
  const raw = env.SUPABASE_URL ?? ''
  if (raw === '') return fail('SUPABASE_URL is not set')
  const url = SUPABASE_URL_PATTERN.test(raw) ? parseUrl(raw) : null
  if (!url) return fail('SUPABASE_URL must be exactly https://<project-ref>.supabase.co')
  return ok(new URL(url.origin))
}

const SECRET_KEY_PREFIX = 'sb_secret_'
const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_'
const VISIBLE_ASCII = /^[\x21-\x7e]+$/

// The messages below never spell out a key prefix: the S-1 leak check searches all output for it.
/** SUPABASE_SECRET_KEY: a Supabase secret API key. Publishable and legacy JWT keys are refused. */
export function readSecretKey(env: Env): EnvResult<Secret> {
  const raw = env.SUPABASE_SECRET_KEY ?? ''
  if (raw === '') return fail('SUPABASE_SECRET_KEY is not set')
  if (raw.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return fail('SUPABASE_SECRET_KEY holds a publishable key; the publisher needs a secret key')
  }
  if (raw.startsWith('eyJ')) {
    return fail('SUPABASE_SECRET_KEY holds a legacy JWT key; the publisher needs a secret key')
  }
  if (!raw.startsWith(SECRET_KEY_PREFIX) || raw.length === SECRET_KEY_PREFIX.length) {
    return fail('SUPABASE_SECRET_KEY must be a Supabase secret key (Project Settings > API Keys)')
  }
  if (!VISIBLE_ASCII.test(raw)) {
    return fail('SUPABASE_SECRET_KEY must be one line with no spaces or control characters')
  }
  return ok(new Secret(raw))
}

const DEPLOY_HOOK_HOST = 'api.vercel.com'
const DEPLOY_HOOK_PATH = /^\/v1\/integrations\/deploy\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/

/** VERCEL_DEPLOY_HOOK_PRODUCTION: https://api.vercel.com/v1/integrations/deploy/<project>/<hook>. */
export function readDeployHookUrl(env: Env): EnvResult<Secret> {
  const raw = env.VERCEL_DEPLOY_HOOK_PRODUCTION ?? ''
  if (raw === '') return fail('VERCEL_DEPLOY_HOOK_PRODUCTION is not set')
  const url = parseUrl(raw)
  const shaped =
    url !== null &&
    url.protocol === 'https:' &&
    url.hostname === DEPLOY_HOOK_HOST &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    DEPLOY_HOOK_PATH.test(url.pathname)
  if (!shaped) {
    return fail(
      'VERCEL_DEPLOY_HOOK_PRODUCTION must be a Vercel deploy hook URL (https://api.vercel.com/v1/integrations/deploy/...)',
    )
  }
  return ok(new Secret(url.href))
}

/** NEXT_PUBLIC_SITE_URL: an https origin such as https://example.vercel.app (no path or query). */
export function readSiteUrl(env: Env): EnvResult<URL> {
  const raw = env.NEXT_PUBLIC_SITE_URL ?? ''
  if (raw === '') return fail('NEXT_PUBLIC_SITE_URL is not set')
  const url = parseUrl(raw)
  if (!url || url.protocol !== 'https:' || !isBareOrigin(url)) {
    return fail('NEXT_PUBLIC_SITE_URL must be an https origin with no path, query or port')
  }
  return ok(new URL(url.origin))
}

export interface StorageCredentials {
  readonly supabaseUrl: URL
  readonly secretKey: Secret
}

export function readStorageCredentials(env: Env): EnvResult<StorageCredentials> {
  const supabaseUrl = readSupabaseUrl(env)
  if (!supabaseUrl.ok) return supabaseUrl
  const secretKey = readSecretKey(env)
  if (!secretKey.ok) return secretKey
  return ok({ supabaseUrl: supabaseUrl.value, secretKey: secretKey.value })
}

export type EnvCheck =
  | { readonly name: PublisherEnvName; readonly ok: true }
  | { readonly name: PublisherEnvName; readonly ok: false; readonly problem: string }

const READERS: Readonly<Record<PublisherEnvName, (env: Env) => EnvResult<unknown>>> = {
  SUPABASE_URL: readSupabaseUrl,
  SUPABASE_SECRET_KEY: readSecretKey,
  VERCEL_DEPLOY_HOOK_PRODUCTION: readDeployHookUrl,
  NEXT_PUBLIC_SITE_URL: readSiteUrl,
}

/** One row per name: ok, or the problem in words. Safe to print; it never contains a value. */
export function checkPublisherEnv(
  env: Env,
  names: readonly PublisherEnvName[] = PUBLISHER_ENV_NAMES,
): readonly EnvCheck[] {
  return names.map((name) => {
    const result = READERS[name](env)
    return result.ok ? { name, ok: true } : { name, ok: false, problem: result.reason }
  })
}
