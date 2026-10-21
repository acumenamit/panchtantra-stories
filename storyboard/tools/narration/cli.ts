// Narration generator (P0-11, M3) on the owner's PC.
//   pnpm narration:plan                           dry run: exact SSML per file, characters, cost; no network
//   pnpm narration:run --sample story/node[,...]  synthesise samples (both languages) for listening
//   pnpm narration:run --all [--force]            synthesise all 190 files
// "run" needs storyboard/.env.local with AZURE_SPEECH_KEY, AZURE_SPEECH_REGION and AZURE_SPEECH_TIER=S0
// (the owner's statement that the resource is on the PAID tier). The key is never printed or logged.
// Outputs go only to storyboard/migration-input/ (gitignored): audio/, narration/plan.json, narration/media-log.json.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoryPackageV1 } from '../../src/core/package/v1'
import type { StoryPackageV1 as Pkg } from '../../src/core/package/v1'
import { mp3Info } from './mp3'
import { RECIPE, billableCharacters, buildNarrationInput, isNarratedLocale } from './recipe'
import type { NarrationInput } from './recipe'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const pkgDir = join(root, 'migration-input/packages')
const outAudio = join(root, 'migration-input/audio')
const outNarr = join(root, 'migration-input/narration')
const PRICE_PER_MILLION_USD = 15 // S1 Neural TTS characters, centralindia, Azure Retail Prices API (checked 2026-10-21)

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

function loadPackages(): Pkg[] {
  return readdirSync(pkgDir)
    .filter((f) => f.endsWith('.phase1.json'))
    .sort()
    .map((f) => StoryPackageV1.parse(JSON.parse(readFileSync(join(pkgDir, f), 'utf8'))))
}

function allInputs(pkgs: Pkg[]): NarrationInput[] {
  const out: NarrationInput[] = []
  for (const p of pkgs)
    for (const n of p.nodes)
      for (const l of p.locales) if (isNarratedLocale(l)) out.push(buildNarrationInput(p, n.id, l))
  return out
}

function plan(inputs: NarrationInput[]): void {
  mkdirSync(outNarr, { recursive: true })
  const entries = inputs.map((x) => ({
    storyId: x.storyId,
    nodeId: x.nodeId,
    locale: x.locale,
    readsQuestion: x.question !== null,
    billableChars: billableCharacters(x.ssml),
    narratedTextSha256: sha256(x.ssml),
    ssml: x.ssml,
  }))
  const chars = entries.reduce((s, e) => s + e.billableChars, 0)
  const summary = {
    recipe: RECIPE,
    files: entries.length,
    withQuestion: entries.filter((e) => e.readsQuestion).length,
    billableCharacters: chars,
    estimatedCostUsd: +((chars * PRICE_PER_MILLION_USD) / 1e6).toFixed(2),
  }
  writeFileSync(join(outNarr, 'plan.json'), JSON.stringify({ summary, entries }, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
  const sample = entries.find((e) => e.locale === 'en' && e.readsQuestion)
  if (sample)
    console.log(
      `\nexample (${sample.storyId}/${sample.nodeId}/en), last 300 chars of SSML:\n…${sample.ssml.slice(-300)}`,
    )
}

async function synthesise(
  x: NarrationInput,
  env: { key: string; region: string; tier: string },
  force: boolean,
) {
  const dir = join(outAudio, x.storyId)
  const file = join(dir, `${x.nodeId}.${x.locale}.mp3`)
  if (existsSync(file) && !force) return { skipped: true as const, file }
  const url = `https://${env.region}.tts.speech.microsoft.com/cognitiveservices/v1`
  let res: Response | undefined
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': RECIPE.outputFormat,
        'User-Agent': 'storyboard-narration',
      },
      body: x.ssml,
    })
    if (res.status !== 429 && res.status < 500) break
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 1000 * 2 ** attempt
    await new Promise((r) => setTimeout(r, wait))
  }
  if (!res || res.status !== 200)
    throw new Error(`${x.storyId}/${x.nodeId}/${x.locale}: HTTP ${res?.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const info = mp3Info(bytes)
  if (
    info.kbps.join() !== '48' ||
    info.sampleRate !== 24000 ||
    !info.mono ||
    info.durationMs <= 0
  ) {
    throw new Error(
      `${x.storyId}/${x.nodeId}/${x.locale}: unexpected audio ${JSON.stringify(info)}`,
    )
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, bytes)
  return {
    skipped: false as const,
    file,
    entry: {
      storyId: x.storyId,
      nodeId: x.nodeId,
      locale: x.locale,
      bytes: bytes.length,
      sha256: sha256(bytes),
      durationMs: info.durationMs,
      narratedTextSha256: sha256(x.ssml),
      voice: RECIPE.voices[x.locale],
      outputFormat: RECIPE.outputFormat,
      recipe: RECIPE.version,
      vendor: 'Microsoft',
      product: 'Azure AI Speech (prebuilt neural voice)',
      region: env.region,
      tier: env.tier,
      generatedAt: new Date().toISOString(),
    },
  }
}

async function run(inputs: NarrationInput[], args: string[]): Promise<number> {
  const envFile = join(root, '.env.local')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  const key = process.env.AZURE_SPEECH_KEY ?? ''
  const region = process.env.AZURE_SPEECH_REGION ?? ''
  const tier = process.env.AZURE_SPEECH_TIER ?? ''
  if (!key || !region)
    throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set in storyboard/.env.local')
  if (tier !== 'S0')
    throw new Error(
      'AZURE_SPEECH_TIER must be S0 (paid tier); free-tier (F0) output has no publishing right',
    )

  const force = args.includes('--force')
  const sampleArg = args[args.indexOf('--sample') + 1]
  let targets = inputs
  if (args.includes('--sample') && sampleArg) {
    const wanted = new Set(sampleArg.split(','))
    targets = inputs.filter((x) => wanted.has(`${x.storyId}/${x.nodeId}`))
  } else if (!args.includes('--all')) {
    throw new Error('Use --sample story/node[,...] or --all')
  }

  mkdirSync(outNarr, { recursive: true })
  const logFile = join(outNarr, 'media-log.json')
  const log: unknown[] = existsSync(logFile) ? JSON.parse(readFileSync(logFile, 'utf8')) : []
  let made = 0
  let skipped = 0
  for (const x of targets) {
    const r = await synthesise(x, { key, region, tier }, force)
    if (r.skipped) skipped++
    else {
      made++
      log.push(r.entry)
      writeFileSync(logFile, JSON.stringify(log, null, 2) + '\n')
      console.log(
        `made ${x.storyId}/${x.nodeId}.${x.locale}.mp3 (${(r.entry.durationMs / 1000).toFixed(1)} s)`,
      )
    }
  }
  console.log(`done: ${made} made, ${skipped} skipped (already exist; use --force to replace)`)
  return 0
}

async function main(): Promise<number> {
  const [mode, ...args] = process.argv.slice(2)
  const inputs = allInputs(loadPackages())
  if (mode === 'plan') {
    plan(inputs)
    return 0
  }
  if (mode === 'run') return run(inputs, args)
  throw new Error('Usage: cli.ts plan | run (--sample story/node[,...] | --all) [--force]')
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  },
)
