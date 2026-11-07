import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkPublisherEnv,
  ENV_FILE,
  loadEnvFile,
  PUBLISHER_ENV_NAMES,
  readDeployHookUrl,
  readSecretKey,
  readSiteUrl,
  readStorageCredentials,
  readSupabaseUrl,
  Secret,
  type Env,
} from './env'

// Fake values are assembled at runtime, so no file holds a string shaped like a real key.
const FAKE_SECRET = ['sb', 'secret', 'fake-for-tests-only-0001'].join('_')
const FAKE_PUBLISHABLE = ['sb', 'publishable', 'fake-for-tests-only-0002'].join('_')
const FAKE_JWT = ['eyJ', 'fakeHeader.fakeBody.fakeSig'].join('')
const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co'
const HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/prj_fakeProject01/fakeHook02'
const SITE_URL = 'https://storyboard-test.vercel.app'

const goodEnv: Env = {
  SUPABASE_URL,
  SUPABASE_SECRET_KEY: FAKE_SECRET,
  VERCEL_DEPLOY_HOOK_PRODUCTION: HOOK_URL,
  NEXT_PUBLIC_SITE_URL: SITE_URL,
}

describe('Secret', () => {
  it('hides the value from String, templates, JSON and inspect, and reveals it on request', () => {
    const secret = new Secret(FAKE_SECRET)
    expect(String(secret)).toBe('[redacted]')
    expect(`${secret}`).toBe('[redacted]')
    expect(JSON.stringify({ secret })).toBe('{"secret":"[redacted]"}')
    expect(inspect(secret)).toBe('[redacted]')
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain(FAKE_SECRET)
    expect(Object.keys(secret)).toEqual([])
    expect(secret.reveal()).toBe(FAKE_SECRET)
  })
})

describe('readSupabaseUrl', () => {
  it('accepts exactly https://<20-character ref>.supabase.co, with or without one trailing slash', () => {
    for (const raw of [SUPABASE_URL, `${SUPABASE_URL}/`]) {
      const result = readSupabaseUrl({ SUPABASE_URL: raw })
      expect(result.ok && result.value.href).toBe(`${SUPABASE_URL}/`)
    }
  })

  it('refuses every other shape without echoing it', () => {
    const bad = [
      'http://abcdefghijklmnopqrst.supabase.co',
      'https://abcdefghijklmnopqrst.supabase.co.evil.example',
      'https://abcdefghijklmnopqrst.supabase.com',
      'https://short.supabase.co',
      'https://ABCDEFGHIJKLMNOPQRST.supabase.co',
      'https://abcdefghijklmnopqrst.supabase.co/storage/v1',
      'https://abcdefghijklmnopqrst.supabase.co/?x=1',
      'https://abcdefghijklmnopqrst.supabase.co:8443',
      'https://user@abcdefghijklmnopqrst.supabase.co',
      ` ${SUPABASE_URL}`,
    ]
    for (const raw of bad) {
      expect(readSupabaseUrl({ SUPABASE_URL: raw })).toEqual({
        ok: false,
        reason: 'SUPABASE_URL must be exactly https://<project-ref>.supabase.co',
      })
    }
    expect(readSupabaseUrl({})).toEqual({ ok: false, reason: 'SUPABASE_URL is not set' })
  })
})

describe('readSecretKey', () => {
  it('accepts a secret key and wraps it', () => {
    const result = readSecretKey({ SUPABASE_SECRET_KEY: FAKE_SECRET })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBeInstanceOf(Secret)
      expect(result.value.reveal()).toBe(FAKE_SECRET)
    }
  })

  it('refuses a publishable key as the secret key', () => {
    expect(readSecretKey({ SUPABASE_SECRET_KEY: FAKE_PUBLISHABLE })).toEqual({
      ok: false,
      reason: 'SUPABASE_SECRET_KEY holds a publishable key; the publisher needs a secret key',
    })
  })

  it('refuses a legacy JWT key, other strings, a bare prefix and whitespace', () => {
    expect(readSecretKey({ SUPABASE_SECRET_KEY: FAKE_JWT })).toEqual({
      ok: false,
      reason: 'SUPABASE_SECRET_KEY holds a legacy JWT key; the publisher needs a secret key',
    })
    const notSecret = {
      ok: false,
      reason: 'SUPABASE_SECRET_KEY must be a Supabase secret key (Project Settings > API Keys)',
    }
    expect(readSecretKey({ SUPABASE_SECRET_KEY: 'service-role-value' })).toEqual(notSecret)
    expect(readSecretKey({ SUPABASE_SECRET_KEY: ['sb', 'secret', ''].join('_') })).toEqual(
      notSecret,
    )
    expect(readSecretKey({ SUPABASE_SECRET_KEY: `${FAKE_SECRET} x` })).toEqual({
      ok: false,
      reason: 'SUPABASE_SECRET_KEY must be one line with no spaces or control characters',
    })
    expect(readSecretKey({})).toEqual({ ok: false, reason: 'SUPABASE_SECRET_KEY is not set' })
  })

  it('never spells out a key prefix in a message (the S-1 leak check searches for it)', () => {
    for (const value of [FAKE_PUBLISHABLE, FAKE_JWT, 'other', `${FAKE_SECRET}\n`]) {
      const result = readSecretKey({ SUPABASE_SECRET_KEY: value })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).not.toContain(['sb', 'secret', ''].join('_'))
        expect(result.reason).not.toContain(['sb', 'publishable', ''].join('_'))
      }
    }
  })
})

describe('readDeployHookUrl', () => {
  it('accepts a Vercel deploy hook URL and wraps it', () => {
    const result = readDeployHookUrl({ VERCEL_DEPLOY_HOOK_PRODUCTION: HOOK_URL })
    expect(result.ok && result.value.reveal()).toBe(HOOK_URL)
    expect(result.ok && String(result.value)).toBe('[redacted]')
  })

  it('refuses anything without the deploy-hook prefix and shape', () => {
    const bad = [
      'http://api.vercel.com/v1/integrations/deploy/prj_fakeProject01/fakeHook02',
      'https://api.vercel.com.evil.example/v1/integrations/deploy/prj_fakeProject01/fakeHook02',
      'https://example.com/v1/integrations/deploy/prj_fakeProject01/fakeHook02',
      'https://api.vercel.com/v1/integrations/deploy/prj_fakeProject01',
      'https://api.vercel.com/v1/integrations/deploy/prj_fakeProject01/fakeHook02/extra',
      'https://api.vercel.com/v1/integrations/deploy/prj_fakeProject01/fakeHook02?buildCache=true',
      'https://api.vercel.com:8443/v1/integrations/deploy/prj_fakeProject01/fakeHook02',
      'not a url',
    ]
    for (const raw of bad) {
      const result = readDeployHookUrl({ VERCEL_DEPLOY_HOOK_PRODUCTION: raw })
      expect(result).toEqual({
        ok: false,
        reason:
          'VERCEL_DEPLOY_HOOK_PRODUCTION must be a Vercel deploy hook URL (https://api.vercel.com/v1/integrations/deploy/...)',
      })
    }
    expect(readDeployHookUrl({})).toEqual({
      ok: false,
      reason: 'VERCEL_DEPLOY_HOOK_PRODUCTION is not set',
    })
  })
})

describe('readSiteUrl', () => {
  it('accepts an https origin, with or without a trailing slash', () => {
    for (const raw of [SITE_URL, `${SITE_URL}/`]) {
      const result = readSiteUrl({ NEXT_PUBLIC_SITE_URL: raw })
      expect(result.ok && result.value.href).toBe(`${SITE_URL}/`)
    }
  })

  it('refuses http, paths, queries, ports and fragments', () => {
    for (const raw of [
      'http://storyboard-test.vercel.app',
      `${SITE_URL}/en`,
      `${SITE_URL}/?x=1`,
      `${SITE_URL}:8443`,
      `${SITE_URL}/#x`,
      'storyboard-test.vercel.app',
    ]) {
      expect(readSiteUrl({ NEXT_PUBLIC_SITE_URL: raw })).toEqual({
        ok: false,
        reason: 'NEXT_PUBLIC_SITE_URL must be an https origin with no path, query or port',
      })
    }
    expect(readSiteUrl({})).toEqual({ ok: false, reason: 'NEXT_PUBLIC_SITE_URL is not set' })
  })
})

describe('readStorageCredentials', () => {
  it('returns the URL and the wrapped key', () => {
    const result = readStorageCredentials(goodEnv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.supabaseUrl.href).toBe(`${SUPABASE_URL}/`)
      expect(JSON.stringify(result.value)).not.toContain(FAKE_SECRET)
    }
  })

  it('reports the first problem', () => {
    expect(readStorageCredentials({ SUPABASE_URL })).toEqual({
      ok: false,
      reason: 'SUPABASE_SECRET_KEY is not set',
    })
  })
})

describe('checkPublisherEnv', () => {
  it('returns one row per name with ok only', () => {
    expect(checkPublisherEnv(goodEnv)).toEqual(
      PUBLISHER_ENV_NAMES.map((name) => ({ name, ok: true })),
    )
  })

  it('checks only the requested names', () => {
    expect(checkPublisherEnv({ NEXT_PUBLIC_SITE_URL: SITE_URL }, ['NEXT_PUBLIC_SITE_URL'])).toEqual(
      [{ name: 'NEXT_PUBLIC_SITE_URL', ok: true }],
    )
  })

  it('names each problem and never contains a value', () => {
    const badEnv: Env = {
      SUPABASE_URL: 'http://value-one.example',
      SUPABASE_SECRET_KEY: FAKE_PUBLISHABLE,
      VERCEL_DEPLOY_HOOK_PRODUCTION: 'https://example.com/prj_fakeProject01/fakeHook02',
      NEXT_PUBLIC_SITE_URL: 'http://value-four.example',
    }
    const rows = checkPublisherEnv(badEnv)
    expect(rows.map((row) => [row.name, row.ok])).toEqual(
      PUBLISHER_ENV_NAMES.map((name) => [name, false]),
    )
    const printed = JSON.stringify(rows)
    for (const value of Object.values(badEnv)) expect(printed).not.toContain(value)
    expect(printed).not.toContain('fakeHook02')
    expect(printed).not.toContain('fake-for-tests-only')
  })
})

describe('loadEnvFile', () => {
  const NAMES = ['PUBLISHER_ENV_TEST_A', 'PUBLISHER_ENV_TEST_B'] as const
  let dir: string | undefined

  afterEach(() => {
    for (const name of NAMES) delete process.env[name]
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('points at storyboard/.env.local by default', () => {
    expect(ENV_FILE.replace(/\\/g, '/')).toMatch(/\/storyboard\/\.env\.local$/)
  })

  it('loads a file into process.env, and a value already in the environment wins', () => {
    dir = mkdtempSync(join(tmpdir(), 'publisher-env-'))
    const file = join(dir, '.env.local')
    writeFileSync(file, 'PUBLISHER_ENV_TEST_A=from-file\nPUBLISHER_ENV_TEST_B=from-file\n')
    process.env.PUBLISHER_ENV_TEST_A = 'from-environment'
    expect(loadEnvFile(file)).toBe(true)
    expect(process.env.PUBLISHER_ENV_TEST_A).toBe('from-environment')
    expect(process.env.PUBLISHER_ENV_TEST_B).toBe('from-file')
  })

  it('returns false for a missing file and changes nothing', () => {
    dir = mkdtempSync(join(tmpdir(), 'publisher-env-'))
    expect(loadEnvFile(join(dir, 'absent.env'))).toBe(false)
    expect(process.env.PUBLISHER_ENV_TEST_B).toBeUndefined()
  })
})
