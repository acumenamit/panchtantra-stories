// The publisher workflows, the line rules over every workflow, ci.yml's paths and the key-rotation
// runbook (design migration-input/p1-step16-design.md §3.20, §3.24, §3.25, §14.3; D16-20, D16-24,
// D16-25, D16-33, D16-34, D16-38; P1-8e, Step 16). The four .github/workflows/publisher-*.yml files
// equal their golden texts and keep their invariants (T16-7); every file under .github/workflows
// passes the line rules W-* of §3.24.2 (T16-8), which refuse every bypass form of §3.24.3 (T16-9);
// ci.yml's two paths lists are pinned (T16-10); docs/runbooks/key-rotation.md names every value,
// holds no secret shape, and its fixture table equals fixtureFacts() and plans through the dispatch
// helper to the P1-8 exit rows (T16-11). The readers here are guard code, each with weakened-reader
// mutants (MW16-n). The repository's files are only read; no test writes, spawns or reaches a
// network, and every key-shaped sample is joined at run time.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANSWER_KEYS } from '../tools/publisher/answers'
import { fixtureFacts } from '../tools/publisher/fixture-store'
import {
  DISPATCH_INPUTS,
  planDispatch,
  type DispatchInput,
  type Workflow,
} from './publisher-dispatch'

const PUBLISHER: readonly Workflow[] = ['approve', 'publish', 'unpublish', 'verify']
const fileOf = (workflow: Workflow) => `publisher-${workflow}.yml`
const PUBLISHER_FILES: ReadonlySet<string> = new Set(PUBLISHER.map(fileOf))
/** The seven files of .github/workflows (W-set). */
const SEVEN: readonly string[] = [
  'ci.yml',
  'keep-alive.yml',
  'live-check.yml',
  ...PUBLISHER.map(fileOf),
]
const WORKFLOWS_DIR = new URL('../../.github/workflows/', import.meta.url)
const RUNBOOK = new URL('../../docs/runbooks/key-rotation.md', import.meta.url)
const TIMEOUT = { timeout: 60_000 }

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'
/** ci.yml's four pinned actions (its checks and e2e jobs), written out here (W-uses, T16-8 g4). */
const PINS: readonly string[] = [
  `actions/checkout@${CHECKOUT_SHA}`,
  'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
  'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
  'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
]

// ---- the golden texts (§3.24.1; P4 passed, so --ignore-scripts stays: B16-implC1-1) ----

/** `${{ <body> }}`, assembled so this source holds no expression of its own. */
const expr = (body: string) => `${'$'}{{ ${body} }}`
const secretLine = (name: string) => `          ${name}: ${expr(`secrets.${name}`)}`
const varLine = (name: string) => `          ${name}: ${expr(`vars.${name}`)}`

interface Golden {
  readonly header: readonly string[]
  readonly inputs: readonly string[]
  readonly fixturesStep: string
  readonly storageStep: string
  readonly env: readonly string[]
  readonly storageTimeout: number
  readonly refused: string
}

const MODE_THREE = (run: string): string[] => [
  '      mode:',
  `        description: 'fixtures: in-memory store, no secret; dry-run: reads Storage, writes nothing; run: ${run}'`,
  '        type: choice',
  '        options:',
  '          - fixtures',
  '          - dry-run',
  '          - run',
  '        default: fixtures',
]
const REFUSED_THREE = 'Refused: dry-run and run dispatch from main only'

const GOLDEN: Readonly<Record<Workflow, Golden>> = {
  approve: {
    header: [
      '# Publisher approve (P1-8e, Step 16; storyboard/migration-input/p1-step16-design.md D16-2 to D16-13).',
      '# Dispatch only. mode fixtures, the default, runs the publisher on its in-memory fixture store with no secret and no',
      '# Environment. dry-run reads Storage and writes nothing; run writes the approval record. Both need the publisher',
      '# Environment and run from main only. Inputs are read from the event file by scripts/publisher-dispatch.ts, never by a',
      "# run line, and no step prints them; a public repository's run page may still show them, so put nothing private here.",
    ],
    inputs: [
      ...MODE_THREE('writes the record'),
      '      story-id:',
      '        description: Story id (a-z, 0-9 and single hyphens)',
      '        type: string',
      '        required: true',
      '      package-prefix:',
      "        description: First 12 to 64 hex characters of the reviewed package's sha256",
      '        type: string',
      '        required: true',
      '      languages-read:',
      '        description: Languages read, comma separated (public on the run page)',
      '        type: string',
      '        required: true',
      '      all-nodes-read:',
      '        description: Every node read in every language',
      '        type: choice',
      '        options:',
      "          - 'no'",
      "          - 'yes'",
      "        default: 'no'",
      '      images-viewed:',
      '        description: Number of pictured nodes viewed (public on the run page)',
      '        type: string',
      '        required: true',
      '      narration-check:',
      '        description: Narration check note, at most 200 characters (public on the run page)',
      '        type: string',
      '        required: true',
      '      devices:',
      '        description: Devices used, comma separated (public on the run page)',
      '        type: string',
      '        required: true',
      '      checklist-complete:',
      '        description: The reviewer checklist is complete',
      '        type: choice',
      '        options:',
      "          - 'no'",
      "          - 'yes'",
      "        default: 'no'",
    ],
    fixturesStep: 'Publisher approve on the fixture store',
    storageStep: 'Publisher approve against the project',
    env: [secretLine('SUPABASE_URL'), secretLine('SUPABASE_SECRET_KEY')],
    storageTimeout: 15,
    refused: REFUSED_THREE,
  },
  publish: {
    header: [
      '# Publisher publish, --feature and --snapshot (P1-8e, Step 16; storyboard/migration-input/p1-step16-design.md D16-2 to D16-13).',
      '# Dispatch only. mode fixtures, the default, runs the publisher on its in-memory fixture store with no secret and no',
      '# Environment. dry-run reads Storage and writes nothing; run writes the snapshot, moves the pointers and calls the deploy',
      '# hook. Both need the publisher Environment and run from main only. Inputs are read from the event file by',
      "# scripts/publisher-dispatch.ts, never by a run line, and no step prints them; a public repository's run page may still",
      '# show them, so put nothing private here.',
    ],
    inputs: [
      ...MODE_THREE('publishes and deploys'),
      '      story-ids:',
      '        description: Story ids to publish, one space apart (empty for --feature or --snapshot alone)',
      '        type: string',
      '        required: false',
      "        default: ''",
      '      feature:',
      '        description: A story id to feature, none to clear, empty to leave',
      '        type: string',
      '        required: false',
      "        default: ''",
      '      snapshot:',
      '        description: An older production seq to roll back to, empty for none',
      '        type: string',
      '        required: false',
      "        default: ''",
    ],
    fixturesStep: 'Publisher publish on the fixture store',
    storageStep: 'Publisher publish against the project',
    env: [
      secretLine('SUPABASE_URL'),
      secretLine('SUPABASE_SECRET_KEY'),
      secretLine('VERCEL_DEPLOY_HOOK_PRODUCTION'),
      varLine('NEXT_PUBLIC_SITE_URL'),
    ],
    storageTimeout: 40,
    refused: REFUSED_THREE,
  },
  unpublish: {
    header: [
      '# Publisher unpublish (P1-8e, Step 16; storyboard/migration-input/p1-step16-design.md D16-2 to D16-13).',
      "# --takedown runs on the owner's PC only (spec section 8) and is never offered here. Dispatch only. mode fixtures, the",
      '# default, runs the publisher on its in-memory fixture store with no secret and no Environment. dry-run reads Storage and',
      '# writes nothing; run withdraws the story from both pointers and calls the deploy hook. Both need the publisher',
      '# Environment and run from main only. Inputs are read from the event file by scripts/publisher-dispatch.ts, never by a',
      "# run line, and no step prints them; a public repository's run page may still show them, so put nothing private here.",
    ],
    inputs: [
      ...MODE_THREE('withdraws the story'),
      '      story-id:',
      '        description: Story id to withdraw from both pointers',
      '        type: string',
      '        required: true',
    ],
    fixturesStep: 'Publisher unpublish on the fixture store',
    storageStep: 'Publisher unpublish against the project',
    env: [
      secretLine('SUPABASE_URL'),
      secretLine('SUPABASE_SECRET_KEY'),
      secretLine('VERCEL_DEPLOY_HOOK_PRODUCTION'),
      varLine('NEXT_PUBLIC_SITE_URL'),
    ],
    storageTimeout: 40,
    refused: REFUSED_THREE,
  },
  verify: {
    header: [
      '# Publisher verify and verify --deep (P1-8e, Step 16; storyboard/migration-input/p1-step16-design.md D16-2 to D16-13).',
      '# Dispatch only. mode fixtures, the default, runs the publisher on its in-memory fixture store with no secret and no',
      '# Environment. run reads Storage and the live site and writes nothing; it needs the publisher Environment and runs from',
      '# main only. Inputs are read from the event file by scripts/publisher-dispatch.ts, never by a run line, and no step',
      "# prints them; a public repository's run page may still show them, so put nothing private here.",
    ],
    inputs: [
      '      mode:',
      "        description: 'fixtures: in-memory store, no secret; run: reads Storage and the live site'",
      '        type: choice',
      '        options:',
      '          - fixtures',
      '          - run',
      '        default: fixtures',
      '      deep:',
      '        description: Also check every object against its name (about 0.35 GB of egress; at most monthly)',
      '        type: boolean',
      '        default: false',
    ],
    fixturesStep: 'Publisher verify on the fixture store',
    storageStep: 'Publisher verify against the project',
    env: [
      secretLine('SUPABASE_URL'),
      secretLine('SUPABASE_SECRET_KEY'),
      varLine('NEXT_PUBLIC_SITE_URL'),
    ],
    storageTimeout: 60,
    refused: 'Refused: mode run dispatches from main only',
  },
}

/** ci.yml's three setup steps, as every fixtures and storage job starts. */
const SETUP: readonly string[] = [
  `      - uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`,
  '        with:',
  '          persist-credentials: false',
  '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0',
  '        with:',
  '          package_json_file: storyboard/package.json',
  '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  '        with:',
  '          node-version-file: storyboard/.nvmrc',
  '          cache: pnpm',
  '          cache-dependency-path: storyboard/pnpm-lock.yaml',
]
const INSTALL = 'pnpm install --frozen-lockfile --ignore-scripts'
const dispatchOf = (workflow: Workflow, job: string) =>
  `pnpm exec tsx scripts/publisher-dispatch.ts ${workflow} ${job}`

/** The template (§3.24.1): only the header, inputs, step names, storage env and timeout, and verify's refusal differ. */
function goldenText(workflow: Workflow): string {
  const golden = GOLDEN[workflow]
  return [
    ...golden.header,
    `name: publisher-${workflow}`,
    '',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    ...golden.inputs,
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  fixtures:',
    "    if: inputs.mode == 'fixtures'",
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 15',
    '    defaults:',
    '      run:',
    '        working-directory: storyboard',
    '    steps:',
    ...SETUP,
    `      - run: ${INSTALL}`,
    `      - name: ${golden.fixturesStep}`,
    `        run: ${dispatchOf(workflow, 'fixtures')}`,
    '',
    '  storage:',
    "    if: inputs.mode != 'fixtures' && github.ref == 'refs/heads/main'",
    '    environment: publisher',
    '    concurrency:',
    '      group: publisher',
    '      cancel-in-progress: false',
    '    runs-on: ubuntu-24.04',
    `    timeout-minutes: ${golden.storageTimeout}`,
    '    defaults:',
    '      run:',
    '        working-directory: storyboard',
    '    steps:',
    ...SETUP,
    `      - run: ${INSTALL}`,
    `      - name: ${golden.storageStep}`,
    '        env:',
    ...golden.env,
    `        run: ${dispatchOf(workflow, 'storage')}`,
    '',
    '  refuse-ref:',
    "    if: inputs.mode != 'fixtures' && github.ref != 'refs/heads/main'",
    '    runs-on: ubuntu-24.04',
    '    timeout-minutes: 2',
    '    steps:',
    `      - name: '${golden.refused}'`,
    '        run: exit 1',
    '',
  ].join('\n')
}

// ---- the workflow reader and the line rules W-* (§3.24.2, D16-33) ----

type ReadResult = { readonly ok: true; readonly text: string } | { readonly ok: false }

/** W-read: strict UTF-8, not empty, no leading BOM, no lone CR; then CRLF becomes LF. */
function readWorkflow(bytes: Uint8Array): ReadResult {
  if (bytes.byteLength === 0) return { ok: false }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { ok: false }
  }
  if (text.startsWith('\uFEFF')) return { ok: false }
  if (/\r(?!\n)/.test(text)) return { ok: false }
  return { ok: true, text: text.replaceAll('\r\n', '\n') }
}

/** The file's text through readWorkflow, or null when it is missing or refused. */
function workflowText(name: string): string | null {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(name, WORKFLOWS_DIR))))
  } catch {
    return null
  }
  const read = readWorkflow(bytes)
  return read.ok ? read.text : null
}

interface Finding {
  readonly rule: string
  readonly line: number
}

/** The four keys the rules read by name, quoted and spaced spellings included; group 1 ends at the key. */
const KEY = /^(\s*(?:-\s+)*["']?)(run-name|run|uses|environment)["']?\s*:/
/** Any mapping key: the prefix (indentation and `- `), the key and the value after `: `. */
const ANY_KEY = /^(\s*(?:-\s+)*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#"'][^:#]*?)\s*:(?:\s+(.*))?$/
const HEADERS: ReadonlySet<string> = new Set(['|', '|-', '>', '>-'])
const TRIGGERS = /pull_request_target|workflow_run|workflow_call/i
const XTRACE: readonly RegExp[] = [/\bset\s+-[A-Za-z]*x/, /xtrace/i, /\b(?:ba)?sh\s+-[A-Za-z]*x/]
const SPANS = /\$\{\{[\s\S]*?\}\}/g
/** A value after `key: ` or `- ` that is one single-quoted scalar (YAML reads no escape there). */
const SINGLE_QUOTED_VALUE = /^(.*?(?::\s+|-\s+))'(?:[^']|'')*'(\s+#.*)?$/

const columnOf = (line: string) => (/^ */.exec(line)?.[0] ?? '').length
const isBlank = (line: string) => /^ *$/.test(line)
const isHeaderValue = (value: string) => /^[|>]/.test(value.trim())

interface ModelLine {
  readonly n: number
  readonly text: string
  readonly column: number
  readonly blank: boolean
  /** 'key' for a run key's own line, 'text' for every line its value continues on. */
  readonly run: 'no' | 'key' | 'text'
  /** Block scalar content: the lines after a `|` or `>` header, of a run key or any other. */
  readonly block: boolean
  /** Outside run text, a line whose first non-space character is `#`. */
  readonly comment: boolean
  /** One of the four keys, outside run text and block content; for a run key, its value. */
  readonly key: { readonly name: string; readonly value: string } | null
}

/**
 * The line model (§3.24.2): a run key's run text is the rest of its line plus every following line
 * that is blank or deeper than the key's column, whatever the value's form; inside it no line is a
 * key or a comment. Any other key whose value is a block header opens block content the same way.
 */
function modelOf(text: string): ModelLine[] {
  const lines: ModelLine[] = []
  let region: { readonly run: boolean; readonly column: number; readonly block: boolean } | null =
    null
  for (const [index, line] of text.split('\n').entries()) {
    const n = index + 1
    const column = columnOf(line)
    const blank = isBlank(line)
    if (region !== null && (blank || column > region.column)) {
      const run = region.run ? 'text' : 'no'
      const comment = !region.run && /^\s*#/.test(line)
      lines.push({ n, text: line, column, blank, run, block: region.block, comment, key: null })
      continue
    }
    region = null
    const comment = /^\s*#/.test(line)
    const match = comment ? null : KEY.exec(line)
    if (match !== null && match[2] === 'run') {
      const value = line.slice(match[0].length)
      region = { run: true, column: (match[1] ?? '').length, block: isHeaderValue(value) }
      const key = { name: 'run', value }
      lines.push({ n, text: line, column, blank, run: 'key', block: false, comment, key })
      continue
    }
    const any = comment ? null : ANY_KEY.exec(line)
    const item = comment ? null : /^(\s*)(?:-\s+)+([|>].*)$/.exec(line)
    if (any !== null && isHeaderValue(any[3] ?? '')) {
      region = { run: false, column: (any[1] ?? '').length, block: true }
    } else if (item !== null) {
      region = { run: false, column: (item[1] ?? '').length, block: true }
    }
    const key = match === null ? null : { name: match[2] ?? '', value: line.slice(match[0].length) }
    lines.push({ n, text: line, column, blank, run: 'no', block: false, comment, key })
  }
  return lines
}

/** The values a line holds for W-anchor and W-tag: its start, after each `- `, after `key: `, flow items. */
function valuesOf(line: string): string[] {
  const values = [line.trim()]
  const item = /^\s*(?:-\s+)+(.*)$/.exec(line)
  if (item !== null) values.push((item[1] ?? '').trim())
  const any = ANY_KEY.exec(line)
  const value = (any?.[3] ?? '').trim()
  values.push(value)
  if (value.startsWith('[')) {
    values.push(
      ...value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((part) => part.trim()),
    )
  }
  return values
}

/** W-escape reads a line without a single-quoted value; every other backslash is a finding. */
function withoutSingleQuoted(line: string): string {
  const match = SINGLE_QUOTED_VALUE.exec(line)
  return match === null ? line : `${match[1] ?? ''}${match[2] ?? ''}`
}

const PERMISSIONS = /^(\s*(?:-\s+)*["']?)permissions["']?\s*:(.*)$/
const uncommented = (line: string) => line.replace(/(?:^|\s+)#.*$/, '')

/** W-permissions: exactly one column-0 block whose only entry is `contents: read`, no job-level block. */
function permissionsFindings(model: readonly ModelLine[]): Finding[] {
  const findings: Finding[] = []
  let topLevel = 0
  for (const [index, line] of model.entries()) {
    if (line.run !== 'no' || line.comment || line.block) continue
    const match = PERMISSIONS.exec(line.text)
    if (match === null) continue
    if ((match[1] ?? '').length > 0) {
      findings.push({ rule: 'W-permissions', line: line.n })
      continue
    }
    if (uncommented(match[2] ?? '').trim() !== '') {
      findings.push({ rule: 'W-permissions', line: line.n })
      continue
    }
    topLevel += 1
    const entries: string[] = []
    for (const next of model.slice(index + 1)) {
      if (next.blank || next.comment) continue
      if (next.column === 0) break
      entries.push(uncommented(next.text).trim())
    }
    if (entries.length !== 1 || entries[0] !== 'contents: read') {
      findings.push({ rule: 'W-permissions', line: line.n })
    }
  }
  if (topLevel !== 1) findings.push({ rule: 'W-permissions', line: 0 })
  return findings
}

/** The W-* findings of one workflow file (W-read and W-set are read before: readWorkflow, setFindings). */
function workflowFindings(name: string, text: string): Finding[] {
  const publisher = PUBLISHER_FILES.has(name)
  const findings: Finding[] = []
  const add = (rule: string, line: number) => findings.push({ rule, line })
  const header = (value: string, line: number) => {
    const trimmed = value.trim()
    if (/^[|>]/.test(trimmed) && !HEADERS.has(trimmed)) add('W-header', line)
  }
  const model = modelOf(text)
  for (const line of model) {
    const { n, text: raw } = line
    if (raw.includes('\t')) add('W-tab', n)
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(raw) || raw.startsWith('%')) add('W-doc', n)
    if (XTRACE.some((pattern) => pattern.test(raw))) add('W-xtrace', n)
    if (!publisher && /secrets/i.test(raw)) add('W-secrets', n)
    if (!line.block && withoutSingleQuoted(raw).includes('\\')) add('W-escape', n)
    if (line.run === 'text') {
      if (raw.includes('${{')) add('W-run-expr', n)
      continue
    }
    if (line.run === 'key') {
      const value = line.key?.value ?? ''
      if (value.includes('${{')) add('W-run-expr', n)
      header(value, n)
      if (/^[&*]/.test(value.trim())) add('W-anchor', n)
      if (value.trim().startsWith('!')) add('W-tag', n)
      continue
    }
    if (TRIGGERS.test(raw)) add('W-trigger', n)
    if (line.comment || line.blank) continue
    if (/^\s*(?:-\s+)*\?(?:\s|$)/.test(raw)) add('W-explicit-key', n)
    if (/[{}]/.test(raw.replace(SPANS, ''))) add('W-flow', n)
    const values = valuesOf(raw)
    if (values.some((value) => /^[&*]/.test(value)) || ANY_KEY.exec(raw)?.[2] === '<<') {
      add('W-anchor', n)
    }
    if (values.some((value) => value.startsWith('!'))) add('W-tag', n)
    if (line.block) continue
    const any = ANY_KEY.exec(raw)
    if (any !== null) header(any[3] ?? '', n)
    else header(/^\s*(?:-\s+)+(.*)$/.exec(raw)?.[1] ?? '', n)
    if (line.key?.name === 'uses') {
      const value = line.key.value
      const cut = value.indexOf(' #')
      if (!PINS.includes((cut < 0 ? value : value.slice(0, cut)).trim())) add('W-uses', n)
    }
    if (line.key?.name === 'environment' && !publisher) add('W-environment', n)
    if (line.key?.name === 'run-name') add('W-run-name', n)
  }
  findings.push(...permissionsFindings(model))
  return findings
}

interface Entry {
  readonly name: string
  readonly file: boolean
}

/** W-set: the folder lists exactly the seven names, each a file; an empty listing fails. */
function setFindings(entries: readonly Entry[]): string[] {
  const listed = entries
  if (listed.length === 0) return ['W-set: an empty listing']
  const findings: string[] = []
  for (const entry of listed) {
    if (!entry.file) findings.push(`W-set: ${entry.name} is not a file`)
    else if (!SEVEN.includes(entry.name)) findings.push(`W-set: ${entry.name}`)
  }
  for (const name of SEVEN) {
    if (!listed.some((entry) => entry.name === name && entry.file)) {
      findings.push(`W-set: ${name} missing`)
    }
  }
  return findings
}

/** The run key, uses key and run text line counts (T16-8 g3: the reader cannot pass on nothing). */
function countsOf(text: string): { run: number; uses: number; runText: number } {
  const model = modelOf(text)
  return {
    run: model.filter((line) => line.run === 'key').length,
    uses: model.filter((line) => line.key?.name === 'uses').length,
    runText: model.filter((line) => line.run === 'text').length,
  }
}

/** Every uses value, cut at its first ` #` and trimmed. */
function usesValuesOf(text: string): string[] {
  return modelOf(text).flatMap((line) => {
    if (line.key?.name !== 'uses') return []
    const cut = line.key.value.indexOf(' #')
    return [(cut < 0 ? line.key.value : line.key.value.slice(0, cut)).trim()]
  })
}

/** Each run key's value: its own line's rest and its run text, trimmed, blank lines dropped. */
function runValuesOf(text: string): string[] {
  const model = modelOf(text)
  const values: string[] = []
  for (const [index, line] of model.entries()) {
    if (line.run !== 'key') continue
    const parts = [line.key?.value ?? '']
    for (const next of model.slice(index + 1)) {
      if (next.run !== 'text') break
      parts.push(next.text)
    }
    values.push(
      parts
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .join('\n'),
    )
  }
  return values
}

// ---- the publisher-structure reader (T16-7 g4, T16-9 g14) ----

interface StepModel {
  readonly lines: readonly number[]
  readonly env: ReadonlySet<number>
  readonly run: string | null
}

interface JobModel {
  readonly name: string
  readonly lines: readonly number[]
  readonly steps: readonly StepModel[]
}

/** The `- ` items under a job's `steps:`, each with its `env:` entries and its `run:` value. */
function stepsOf(raw: readonly string[], lines: readonly number[]): StepModel[] {
  const steps: number[][] = []
  let inSteps = false
  for (const index of lines) {
    const line = raw[index] ?? ''
    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true
      continue
    }
    if (!inSteps) continue
    if (!isBlank(line) && columnOf(line) <= 4) {
      inSteps = false
      continue
    }
    if (/^ {6}- /.test(line)) steps.push([index])
    else steps.at(-1)?.push(index)
  }
  return steps.map((stepLines) => {
    const env = new Set<number>()
    let run: string | null = null
    let inEnv = false
    for (const index of stepLines) {
      // The item's first key sits at column 8, like the keys after it.
      const line = (raw[index] ?? '').replace(/^ {6}- /, '        ')
      if (isBlank(line)) continue
      if (inEnv && columnOf(line) > 8) {
        env.add(index)
        continue
      }
      inEnv = /^ {8}env:\s*$/.test(line)
      const value = /^ {8}run:\s*(.*)$/.exec(line)
      if (value !== null) run = (value[1] ?? '').trim()
    }
    return { lines: stepLines, env, run }
  })
}

/** The jobs under `jobs:`, by their two-space keys. */
function jobsOf(text: string): JobModel[] {
  const raw = text.split('\n')
  const jobs: { name: string; lines: number[] }[] = []
  let inJobs = false
  for (const [index, line] of raw.entries()) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    if (/^[^\s#]/.test(line)) {
      inJobs = false
      continue
    }
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (job !== null) jobs.push({ name: job[1] ?? '', lines: [] })
    else jobs.at(-1)?.lines.push(index)
  }
  return jobs.map((job) => ({ ...job, steps: stepsOf(raw, job.lines) }))
}

const SECRET_OR_VAR = /secrets|\bvars\b/i

/** T16-7 g4: every secrets or vars line in the storage dispatch step's env; environment on storage only. */
function placementFindings(workflow: Workflow, text: string): string[] {
  const raw = text.split('\n')
  const jobs = jobsOf(text)
  const findings: string[] = []
  for (const [index, line] of raw.entries()) {
    if (!SECRET_OR_VAR.test(line)) continue
    const job = jobs.find((candidate) => candidate.lines.includes(index))
    const step = job?.steps.find((candidate) => candidate.lines.includes(index))
    const dispatchStep = step?.run === dispatchOf(workflow, 'storage')
    const placed = job?.name === 'storage' && dispatchStep && (step?.env.has(index) ?? false)
    if (!placed) findings.push(`line ${index + 1} (${job?.name ?? 'no job'}): ${line.trim()}`)
  }
  const storage = jobs.find((job) => job.name === 'storage')
  if (storage === undefined) findings.push('no storage job')
  for (const job of jobs) {
    const environment = job.lines.filter((index) => /environment/i.test(raw[index] ?? ''))
    const want = job.name === 'storage' ? ['    environment: publisher'] : []
    const got = environment.map((index) => raw[index] ?? '')
    if (JSON.stringify(got) !== JSON.stringify(want)) findings.push(`${job.name}: environment`)
  }
  return findings
}

/** T16-7 g5: inputs only on the three if: lines, no github.event, github.ref only on two of them, no ${{ in run text. */
function expressionFindings(text: string): string[] {
  const raw = text.split('\n')
  const jobs = jobsOf(text)
  const ifLine = (name: string) =>
    jobs
      .find((job) => job.name === name)
      ?.lines.find((index) => /^ {4}if:/.test(raw[index] ?? '')) ?? -1
  const ifs = ['fixtures', 'storage', 'refuse-ref'].map(ifLine)
  const linesWith = (pattern: RegExp) =>
    raw.flatMap((line, index) => (pattern.test(line) ? [index] : []))
  const findings: string[] = []
  if (ifs.includes(-1)) findings.push('a job without its if: line')
  if (JSON.stringify(linesWith(/inputs\s*[.[]/i)) !== JSON.stringify(ifs)) {
    findings.push('inputs outside the three if: lines')
  }
  if (linesWith(/github\s*(?:\.\s*|\[\s*['"])event/i).length > 0) findings.push('github.event')
  if (
    JSON.stringify(linesWith(/github\s*(?:\.\s*|\[\s*['"])ref/i)) !== JSON.stringify(ifs.slice(1))
  ) {
    findings.push('github.ref outside the storage and refuse-ref if: lines')
  }
  for (const line of modelOf(text)) {
    if (line.run !== 'no' && line.text.includes('${{')) findings.push(`line ${line.n}: run text`)
  }
  return findings
}

/** T16-7 g6: one `concurrency:` block, in the storage job: group publisher, cancel-in-progress false. */
function concurrencyFindings(text: string): string[] {
  const raw = text.split('\n')
  const storage = jobsOf(text).find((job) => job.name === 'storage')
  const at = raw.flatMap((line, index) => (/concurrency/i.test(line) ? [index] : []))
  const first = at[0] ?? -1
  const findings: string[] = []
  if (at.length !== 1) findings.push(`${at.length} concurrency lines`)
  if (!(storage?.lines.includes(first) ?? false))
    findings.push('concurrency outside the storage job')
  const block = raw.slice(first, first + 3).join('\n')
  if (block !== '    concurrency:\n      group: publisher\n      cancel-in-progress: false') {
    findings.push(`not group publisher and cancel-in-progress false: ${JSON.stringify(block)}`)
  }
  if (columnOf(raw[first + 3] ?? '') > 4) findings.push('a third concurrency entry')
  return findings
}

const groupsOf = (text: string) =>
  text.split('\n').flatMap((line) => {
    const group = /^\s*group\s*:\s*(.*)$/.exec(line)
    return group === null ? [] : [(group[1] ?? '').trim()]
  })

/** T16-7 g7: no echo of any form in a publisher file. */
const NO_ECHO: readonly (readonly [string, RegExp])[] = [
  ['set -x', /\bset\s+-[A-Za-z]*x/],
  ['echo', /\becho\b/i],
  ['printf', /\bprintf\b/i],
  ['printenv', /\bprintenv\b/i],
  ['run-name', /run-name/i],
  ['GITHUB_STEP_SUMMARY', /GITHUB_STEP_SUMMARY/i],
  ['::', /::/],
  ['toJSON', /tojson/i],
  ['continue-on-error', /continue-on-error/i],
  ['shell:', /^\s*(?:-\s+)*["']?shell["']?\s*:/],
]

function echoFindings(text: string): string[] {
  const findings = text
    .split('\n')
    .flatMap((line, index) =>
      NO_ECHO.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${index + 1} ${what}`),
    )
  for (const value of runValuesOf(text)) {
    if (/(?:^|[\s;&|(])env(?:\s|$)/.test(value)) findings.push(`an env command: ${value}`)
  }
  return findings
}

/** The keys under `on:`. */
function triggersOf(text: string): string[] {
  const raw = text.split('\n')
  const on = raw.flatMap((line, index) => (/^["']?on["']?\s*:/.test(line) ? [index] : []))
  if (on.length !== 1 || raw[on[0] ?? 0] !== 'on:') return [`${on.length} on: keys`]
  const keys: string[] = []
  for (const line of raw.slice((on[0] ?? 0) + 1)) {
    if (/^[^\s#]/.test(line)) break
    const key = /^ {2}([^\s:#][^:]*):/.exec(line)
    if (key !== null) keys.push(key[1] ?? '')
  }
  return keys
}

/** The first three steps of a job, line for line (T16-7 g8). */
function setupOf(text: string, name: string): string[] {
  const raw = text.split('\n')
  const job = jobsOf(text).find((candidate) => candidate.name === name)
  return (job?.steps.slice(0, 3) ?? []).flatMap((step) => step.lines.map((i) => raw[i] ?? ''))
}

interface InputBlock {
  readonly name: string
  readonly props: ReadonlyMap<string, string>
  readonly options: readonly string[]
}

const scalarOf = (raw: string) => {
  const trimmed = raw.trim()
  const quoted = /^'((?:[^']|'')*)'$/.exec(trimmed)
  return quoted === null ? trimmed : (quoted[1] ?? '').replaceAll("''", "'")
}

/** The workflow_dispatch inputs block: each input at column 6, its keys at 8, options at 10. */
function inputBlocksOf(text: string): InputBlock[] {
  const raw = text.split('\n')
  const start = raw.indexOf('    inputs:')
  const blocks: { name: string; props: Map<string, string>; options: string[] }[] = []
  if (start < 0) return blocks
  let inOptions = false
  for (const line of raw.slice(start + 1)) {
    if (!isBlank(line) && columnOf(line) <= 4) break
    const input = /^ {6}([a-z][a-z0-9-]*):\s*$/.exec(line)
    if (input !== null) {
      blocks.push({ name: input[1] ?? '', props: new Map(), options: [] })
      inOptions = false
      continue
    }
    const current = blocks.at(-1)
    const prop = /^ {8}([a-z-]+):\s*(.*)$/.exec(line)
    if (prop !== null && current !== undefined) {
      current.props.set(prop[1] ?? '', prop[2] ?? '')
      inOptions = prop[1] === 'options'
      continue
    }
    const option = /^ {10}- (.*)$/.exec(line)
    if (option !== null && current !== undefined && inOptions)
      current.options.push(scalarOf(option[1] ?? ''))
  }
  return blocks
}

/** The file's inputs in DISPATCH_INPUTS' shape (B16-implC1-2: no `required:` reads as false). */
function declaredInputs(text: string): DispatchInput[] {
  return inputBlocksOf(text).map(({ name, props, options }) => {
    const type = props.get('type') ?? ''
    const raw = props.get('default')
    const fallback =
      raw === undefined
        ? null
        : type === 'boolean'
          ? raw === 'true'
            ? true
            : raw === 'false'
              ? false
              : raw
          : scalarOf(raw)
    return {
      name,
      type: type as DispatchInput['type'],
      required: props.get('required') === 'true',
      default: fallback,
      options: type === 'choice' ? options : null,
    }
  })
}

// ---- ci.yml's paths (§3.24.4) ----

const EIGHT: readonly string[] = [
  "'storyboard/**'",
  "'pt/src/stories/**'",
  "'.github/**'",
  "'docs/**'",
  "'README.md'",
  "'.gitignore'",
  "'.gitattributes'",
  "'*'",
]

/** The `paths:` items (as written, comments stripped) under `on:`'s push and pull_request. */
function pathsListsOf(text: string): {
  readonly push: string[] | null
  readonly pullRequest: string[] | null
} {
  const raw = text.split('\n')
  const listOf = (event: string): string[] | null => {
    const start = raw.findIndex((line) => uncommented(line) === `  ${event}:`)
    if (start < 0) return null
    let paths = -1
    for (let index = start + 1; index < raw.length; index += 1) {
      const line = uncommented(raw[index] ?? '')
      if (isBlank(line)) continue
      if (columnOf(line) <= 2) break
      if (/^\s*paths:\s*$/.test(line)) {
        paths = index
        break
      }
    }
    if (paths < 0) return null
    const column = columnOf(raw[paths] ?? '')
    const items: string[] = []
    for (const original of raw.slice(paths + 1)) {
      const line = uncommented(original)
      if (isBlank(line)) continue
      if (columnOf(line) <= column) break
      const item = /^\s*-\s+(.*)$/.exec(line)
      items.push(item === null ? `not an item: ${line.trim()}` : (item[1] ?? '').trim())
    }
    return items
  }
  return { push: listOf('push'), pullRequest: listOf('pull_request') }
}

// ---- the runbook (§3.25) ----

const NAMES: readonly string[] = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_URL',
  'VERCEL_DEPLOY_HOOK_PRODUCTION',
  'NEXT_PUBLIC_SITE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'READER_DB_URL',
  'HF_TOKEN',
]

/** §3.25's nine secret shapes; the key-shaped ones are assembled at run time. */
const SHAPES: readonly (readonly [string, RegExp])[] = [
  ['sb_secret', new RegExp(['sb', 'secret'].join('_'), 'i')],
  ['sb_publishable_ and 6', new RegExp(`${['sb', 'publishable', ''].join('_')}[A-Za-z0-9_-]{6,}`)],
  ['eyJ and 10', new RegExp(`${'ey'}J[A-Za-z0-9_-]{10,}`)],
  [
    'a deploy hook URL',
    new RegExp(
      ['api\\.vercel\\.com', 'v1', 'integrations', 'deploy', '[A-Za-z0-9]'].join('\\/'),
      'i',
    ),
  ],
  ['hf_ and 10', new RegExp(`${'hf'}_[A-Za-z0-9]{10,}`)],
  ['postgres://', /postgres(?:ql)?:\/\//i],
  ['a project ref host', /[a-z0-9]{20}\.supabase\.co/i],
  ['storage/v1', /storage\/+v1/i],
  ['apikey:', /apikey["']?\s*[:=]/i],
]

/** Each maximal run of %XX decoded; null when a run does not decode or a `%` has no two hex digits. */
function percentDecoded(text: string): string | null {
  const malformed = /%(?![0-9A-Fa-f]{2})/.test(text)
  let failed = false
  const decoded = text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      failed = true
      return run
    }
  })
  return malformed || failed ? null : decoded
}

/** One left-to-right pass: backslash-u and four hex digits, backslash-slash and a double backslash. */
const jsonUnescaped = (text: string) =>
  text.replace(/\\(?:u([0-9A-Fa-f]{4})|\/|\\)/g, (whole: string, hex: string | undefined) =>
    hex !== undefined ? String.fromCharCode(parseInt(hex, 16)) : whole === '\\/' ? '/' : '\\',
  )

/** The shapes found in the raw text, its %XX-decoded and JSON-unescaped forms and their crossings. */
function shapeFindings(text: string): string[] {
  const decoded = percentDecoded(text)
  const unescaped = jsonUnescaped(text)
  const views: readonly (readonly [string, string | null])[] = [
    ['raw', text],
    ['%XX-decoded', decoded],
    ['JSON-unescaped', unescaped],
    ['%XX-decoded then JSON-unescaped', decoded === null ? null : jsonUnescaped(decoded)],
    ['JSON-unescaped then %XX-decoded', percentDecoded(unescaped)],
  ]
  const findings: string[] = []
  for (const [view, value] of views) {
    if (value === null) {
      findings.push(`${view}: a malformed %XX run`)
      continue
    }
    for (const [shape, pattern] of SHAPES)
      if (pattern.test(value)) findings.push(`${view}: ${shape}`)
  }
  return findings
}

/** The runbook's text (strict UTF-8, CRLF read as LF), or '' when it cannot be read. */
function runbookText(): string {
  try {
    const bytes = readFileSync(fileURLToPath(RUNBOOK))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n')
  } catch {
    return ''
  }
}

/** The `## n.` sections, by number, in file order. */
function sectionsOf(text: string): Map<number, string> {
  const heads = [...text.matchAll(/^## (\d+)\. .*$/gm)]
  const sections = new Map<number, string>()
  for (const [index, head] of heads.entries()) {
    const end = heads[index + 1]?.index ?? text.length
    sections.set(Number(head[1]), text.slice(head.index, end))
  }
  return sections
}

const TABLE_LABELS: readonly string[] = [
  'approve story-id',
  'approve package-prefix',
  ...ANSWER_KEYS,
  'publish story-ids',
  'publish feature',
  'publish snapshot',
  'unpublish story-id',
]

/** Two-column rows whose value is in backticks: `| label | \`value\` |`. */
const tableOf = (section: string): [string, string][] =>
  [...section.matchAll(/^\|\s*([^|`]+?)\s*\|\s*`([^`|]*)`\s*\|\s*$/gm)].map((row) => [
    row[1] ?? '',
    row[2] ?? '',
  ])

/** §3.25's required phrases; the second element says whether case is ignored. */
const PHRASES: readonly (readonly [string, boolean])[] = [
  ['dispatch a new run from main', false],
  ['never cancel a running storage job', true],
  ['never enable debug logging', true],
  ['a third dispatch cancels the waiting one', false],
  ['a separate secret key for Actions', false],
  ['a separate deploy hook for Actions', false],
  ['--takedown runs on this PC only', false],
  ['never type a secret value in chat', true],
]

const BASE_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_EVENT_PATH: '/run/event.json',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ATTEMPT: '1',
} as const

/** The owner's fixtures dispatch (OWNER SETUP STEPS 1-8) through the helper, from an event file. */
const ownerPlan = (workflow: Workflow, inputs: Readonly<Record<string, unknown>>) =>
  planDispatch([workflow, 'fixtures'], {
    env: BASE_ENV,
    platform: 'linux',
    readFile: () => new TextEncoder().encode(JSON.stringify({ inputs })),
  })

// ---- the T16-9 samples ----

/** A clean frame for the line-rule samples: one permissions block, then the sample's lines. */
const SCAFFOLD = 'on: workflow_dispatch\npermissions:\n  contents: read\njobs:\n'
const rulesOf = (sample: string, name = 'sample.yml') =>
  workflowFindings(name, `${SCAFFOLD}${sample}\n`).map((finding) => finding.rule)
const textRules = (text: string) =>
  workflowFindings('sample.yml', text).map((finding) => finding.rule)

function refuses(group: string, rule: string, samples: readonly string[], name?: string) {
  for (const sample of samples) {
    expect
      .soft(rulesOf(sample, name), `(${group}) ${rule}: ${JSON.stringify(sample)}`)
      .toContain(rule)
  }
}

function clean(group: string, samples: readonly string[]) {
  for (const sample of samples) {
    expect.soft(rulesOf(sample), `(${group}) clean: ${JSON.stringify(sample)}`).toEqual([])
  }
}

describe('publisher-workflows: the publisher files, the line rules, ci.yml paths and the runbook', () => {
  it("T16-7 the four publisher files equal their golden texts, and each keeps its invariants: dispatch only, contents read, secrets and vars only in the storage dispatch step, inputs only in if:, one concurrency group, fixed run lines, ci.yml's pinned actions, the helper's input table (A5, A7, CRIT-5, CRIT-14)", () => {
    const texts = new Map<Workflow, string>()
    for (const workflow of PUBLISHER) {
      const text = workflowText(fileOf(workflow))
      expect(
        text !== null && text.length > 0,
        `precondition: ${fileOf(workflow)} exists, reads ok and is not empty`,
      ).toBe(true)
      if (text !== null) texts.set(workflow, text)
    }
    const ci = workflowText('ci.yml') ?? ''
    const ciSetup = setupOf(ci, 'checks')
    const ciUses = new Set(usesValuesOf(ci))
    expect(
      [ciSetup.length, ciUses.size],
      "precondition: ci.yml's checks job starts with its three setup steps (11 lines) and ci.yml pins four actions",
    ).toEqual([11, 4])
    const counts: Readonly<Record<Workflow, readonly [number, number]>> = {
      approve: [2, 0],
      publish: [3, 1],
      unpublish: [3, 1],
      verify: [2, 1],
    }
    const publicInputs = ['languages-read', 'images-viewed', 'narration-check', 'devices']
    const groups: string[] = []
    for (const [workflow, text] of texts) {
      const name = fileOf(workflow)
      const raw = text.split('\n')
      // g1: the golden text (MU16-65).
      expect.soft(text, `(g1) ${name} equals its golden text`).toBe(goldenText(workflow))
      // g2: dispatch only (MT16-1).
      expect
        .soft(triggersOf(text), `(g2) ${name}: on: holds workflow_dispatch only`)
        .toEqual(['workflow_dispatch'])
      // g3: one workflow-level contents: read, no job-level block (MT16-2).
      expect
        .soft(permissionsFindings(modelOf(text)), `(g3) ${name}: permissions are contents: read`)
        .toEqual([])
      // g4: secrets and vars only in the storage dispatch step's env (MT16-3).
      expect
        .soft(
          placementFindings(workflow, text),
          `(g4) ${name}: secrets and vars only in the storage dispatch step's env, environment: publisher on storage only`,
        )
        .toEqual([])
      const secretLines = raw.filter((line) => /secrets/i.test(line)).length
      const varLines = raw.filter((line) => /\bvars\b/i.test(line)).length
      expect
        .soft([secretLines, varLines], `(g4) ${name}: the secrets and vars line counts`)
        .toEqual(counts[workflow])
      // g5: inputs only in if:, no github.event, no expression in run text (MT16-4).
      expect
        .soft(expressionFindings(text), `(g5) ${name}: inputs and github.ref only on the if: lines`)
        .toEqual([])
      // g6: one concurrency group (MT16-5).
      expect
        .soft(
          concurrencyFindings(text),
          `(g6) ${name}: concurrency group publisher on storage only`,
        )
        .toEqual([])
      groups.push(...groupsOf(text))
      // g7: the fixed run lines and no echo (MT16-6, MT16-7).
      const runs = [
        'exit 1',
        dispatchOf(workflow, 'fixtures'),
        dispatchOf(workflow, 'storage'),
        INSTALL,
        INSTALL,
        'working-directory: storyboard',
        'working-directory: storyboard',
      ].sort()
      expect.soft(runValuesOf(text).sort(), `(g7) ${name}: the run values`).toEqual(runs)
      expect.soft(echoFindings(text), `(g7) ${name}: no echo, summary or shell`).toEqual([])
      // g8: ci.yml's pinned actions and setup steps (MT16-8).
      expect
        .soft(
          usesValuesOf(text).filter((value) => !ciUses.has(value)),
          `(g8) ${name}: every uses: is one of ci.yml's pins`,
        )
        .toEqual([])
      expect
        .soft(
          [setupOf(text, 'fixtures'), setupOf(text, 'storage')],
          `(g8) ${name}: the fixtures and storage jobs start with ci.yml's three setup steps`,
        )
        .toEqual([ciSetup, ciSetup])
      // g9: the helper's input table and the public-input descriptions (MU16-66, MT16-9).
      expect
        .soft(declaredInputs(text), `(g9) ${name}: DISPATCH_INPUTS equals the file's inputs`)
        .toEqual(DISPATCH_INPUTS[workflow])
      for (const block of inputBlocksOf(text)) {
        if (!publicInputs.includes(block.name)) continue
        expect
          .soft(
            block.props.get('description') ?? '',
            `(g9) ${name}: ${block.name}'s description says it is public`,
          )
          .toContain('(public on the run page)')
      }
    }
    expect
      .soft([...new Set(groups)], '(g6) one group string across the four files')
      .toEqual(['publisher'])
  })

  it("T16-8 line rules over the real files: exactly the seven names, no finding, the run and uses counts pinned so the reader cannot pass by finding nothing, ci.yml's four pins, permissions read-only everywhere (A7, CRIT-2, CRIT-7 item 6)", () => {
    // g1: the folder (MU16-67, MT16-10).
    const entries = readdirSync(fileURLToPath(WORKFLOWS_DIR), { withFileTypes: true }).map(
      (entry) => ({ name: entry.name, file: entry.isFile() }),
    )
    expect
      .soft(
        entries.map((entry) => entry.name).sort(),
        '(g1) .github/workflows holds exactly the seven names',
      )
      .toEqual([...SEVEN].sort())
    expect.soft(setFindings(entries), '(g1) W-set: seven files, no folder, not empty').toEqual([])
    const texts = new Map<string, string>()
    for (const name of SEVEN) {
      const text = workflowText(name)
      expect(text !== null, `precondition: ${name} reads ok`).toBe(true)
      if (text !== null) texts.set(name, text)
    }
    // g2: no finding in any real file (MU16-68).
    for (const [name, text] of texts) {
      expect.soft(workflowFindings(name, text), `(g2) ${name} has no line-rule finding`).toEqual([])
    }
    // g3: the counts, so the reader cannot pass by reading nothing (MW16-3).
    const count = (name: string) => countsOf(texts.get(name) ?? '')
    const atLeast = (name: string, what: 'run' | 'uses' | 'runText', least: number) =>
      expect
        .soft(count(name)[what], `(g3) ${name}: ${what} at least ${least}`)
        .toBeGreaterThanOrEqual(least)
    atLeast('ci.yml', 'run', 15)
    atLeast('keep-alive.yml', 'run', 3)
    atLeast('live-check.yml', 'run', 3)
    atLeast('keep-alive.yml', 'runText', 90)
    atLeast('ci.yml', 'uses', 7)
    atLeast('live-check.yml', 'uses', 3)
    for (const workflow of PUBLISHER) {
      const { run, uses } = count(fileOf(workflow))
      expect
        .soft([run, uses], `(g3) ${fileOf(workflow)}: 7 run keys and 6 uses keys`)
        .toEqual([7, 6])
    }
    // g4: ci.yml's pins (MU16-69).
    expect
      .soft([...new Set(usesValuesOf(texts.get('ci.yml') ?? ''))].sort(), "(g4) ci.yml's four pins")
      .toEqual([...PINS].sort())
    // g5: permissions read-only in all seven (MU16-70).
    for (const [name, text] of texts) {
      expect.soft(permissionsFindings(modelOf(text)), `(g5) ${name}: W-permissions`).toEqual([])
    }
  })

  it('T16-9 line rules refuse every bypass form, and the near misses stay clean (A7, CRIT-2, CRIT-3; §3.24.3)', () => {
    expect(rulesOf(''), 'precondition: the scaffold alone has no finding').toEqual([])
    const x = expr('inputs.x')
    // g1: the run text extent (MW16-3 shared, MW16-4).
    refuses('g1', 'W-run-expr', [
      `run: |\n\n  ${x}`,
      `- run: echo\n    ${x}`,
      `run: "echo\n  ${expr('github.event.inputs.x')}"`,
    ])
    clean('g1', ['run: |\n\n  call() {'])
    refuses('g1', 'W-flow', ['- run: x\n  env: {A: 1}'])
    // g2: block headers (MW16-5, MW16-5b).
    refuses(
      'g2',
      'W-header',
      ['|+', '>+', '|2', '|-2', '>2-', '| # note'].map((head) => `run: ${head}\n  echo ok`),
    )
    clean(
      'g2',
      ['|', '|-', '>', '>-'].map((head) => `run: ${head}\n  echo ok`),
    )
    // g3: quoted, spaced and explicit keys (MW16-6, MW16-7).
    refuses('g3', 'W-run-expr', [
      `"run": echo ${x}`,
      `'run': echo ${x}`,
      `run : echo ${x}`,
      `- "run": echo ${x}`,
    ])
    refuses('g3', 'W-uses', ['"uses": actions/checkout@v4', 'uses : actions/checkout@v4'])
    refuses('g3', 'W-environment', ['"environment": publisher', 'environment : publisher'])
    refuses('g3', 'W-explicit-key', ['? run', '- ? run'])
    // g4: escapes in double-quoted values, run values included (MW16-8, MW16-48, MW16-8b, MW16-8c).
    refuses('g4', 'W-escape', [
      'X: "\\u0024{{ inputs.x }}"',
      'X: "\\x24{{ secrets.Y }}"',
      'name: "a\\"b"',
      '- run: "\\x24{{ secrets.Y }}"',
      'run: "echo \\x24{{ inputs.x }}"',
      '"r\\u0075n": echo',
      'on: ["pull_request_t\\u0061rget"]',
      'X: "a\n  # \\x24{{ inputs.x }}"',
    ])
    refuses('g4', 'W-run-expr', [`run: "echo ${x}"`])
    clean('g4', ["X: 'a\\b'", 'X: "plain"', "run: |\n  sed 's/\\{0,1\\}/x/'"])
    // g5: secrets in any case, environment keys; a publisher file is governed by its golden text
    // (MW16-9, MW16-36, MW16-9b, MW16-36b).
    refuses('g5', 'W-secrets', [
      `X: ${expr('SECRETS.X')}`,
      `X: ${expr('Secrets.X')}`,
      'run: |\n  echo secrets.X',
      `X: ${expr('toJSON(secrets)')}`,
    ])
    refuses('g5', 'W-environment', ['environment: publisher', 'environment:\n  name: publisher'])
    for (const sample of [`X: ${expr('secrets.X')}`, 'environment: publisher']) {
      expect
        .soft(
          rulesOf(sample, 'publisher-approve.yml'),
          `(g5) a publisher file name: no W-secrets or W-environment: ${JSON.stringify(sample)}`,
        )
        .toEqual([])
    }
    // g6: uses values (MW16-10, MW16-11, MW16-35, MW16-37).
    refuses('g6', 'W-flow', ['- {uses: x}'])
    refuses('g6', 'W-uses', [
      'uses: actions/checkout@v4',
      `uses: actions/checkout@${'a'.repeat(40)}`,
      `uses: Actions/checkout@${CHECKOUT_SHA}`,
      `uses: actions/checkout@${CHECKOUT_SHA}x`,
      'uses: ./local',
      'uses: docker://x',
      `uses: "actions/checkout@${CHECKOUT_SHA}"`,
    ])
    clean('g6', [`- uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`])
    // g7: expressions in run text of every form (MW16-12).
    refuses('g7', 'W-run-expr', [
      `run: |\n  echo ${'$'}{{inputs.x}}`,
      `run: |\n  echo ${expr("github['event']['inputs']")}`,
      `run: |\n  echo ${expr("format('{0}', inputs.x)")}`,
      `run: echo ${x}`,
      `run: >\n  echo ${x}`,
      `defaults:\n  run:\n    working-directory: ${expr('inputs.d')}`,
    ])
    // g8: forbidden triggers in any case, comments included (MW16-13, MW16-14).
    refuses('g8', 'W-trigger', [
      'on: [pull_request_target]',
      'pull_request_target:',
      'Pull_Request_Target:',
      'workflow_run:',
      'WORKFLOW_CALL',
      '# pull_request_target',
    ])
    // g9: anchors, tabs, documents, tags, flow maps; the near misses (MW16-15, MW16-16, MW16-31 to
    // MW16-35).
    refuses('g9', 'W-anchor', ['x: &a y', 'x: *a', '<<: *a', '- *a'])
    refuses('g9', 'W-tab', ['\tx: y'])
    refuses('g9', 'W-doc', ['---', '...', '%YAML 1.2'])
    refuses('g9', 'W-tag', ['x: !!str y'])
    refuses('g9', 'W-flow', ['env: {A: b}', 'with: {x: y}'])
    clean('g9', [
      "- '*'",
      "- cron: '17 3,11,19 * * *'",
      `if: ${expr('!cancelled()')}`,
      `group: ci-${expr('github.ref')}`,
      'branches: [main]',
      "    if: github.event_name != 'repository_dispatch' || github.event.client_payload.environment == 'production'",
    ])
    // g10: xtrace in any spelling (MW16-17, MW16-17b).
    refuses('g10', 'W-xtrace', [
      'run: |\n  set -x',
      'run: |\n  set -euxo pipefail',
      'run: |\n  set -o xtrace',
      'run: |\n  bash -x s.sh',
      'shell: bash -x {0}',
    ])
    clean('g10', ['run: |\n  set -euo pipefail'])
    // g11: permissions (MW16-18, MW16-18b).
    const job = 'jobs:\n  j:\n    runs-on: ubuntu-24.04\n'
    const top = 'on: workflow_dispatch\n'
    for (const text of [
      `${top}${job}`,
      `${top}permissions:\n  contents: write\n${job}`,
      `${top}permissions: write-all\n${job}`,
      `${top}permissions:\n  contents: read\n  actions: read\n${job}`,
      `${top}permissions:\n  contents: read\n${job}    permissions:\n      contents: read\n`,
    ]) {
      expect
        .soft(textRules(text), `(g11) W-permissions: ${JSON.stringify(text)}`)
        .toContain('W-permissions')
    }
    const noted = `${top}permissions:\n  contents: read # note\n${job}`
    expect.soft(textRules(noted), `(g11) clean: ${JSON.stringify(noted)}`).toEqual([])
    // g12: W-read and W-tab (MW16-19, MW16-19b, MW16-32 shared).
    const encode = (text: string) => new TextEncoder().encode(text)
    const unreadable: readonly (readonly [string, Uint8Array])[] = [
      ['an empty file', new Uint8Array()],
      ['a lone CR', encode('a: b\rc: d\n')],
      ['a BOM', encode('\uFEFFa: b\n')],
      ['C3 28', Uint8Array.of(0x61, 0x3a, 0x20, 0xc3, 0x28, 0x0a)],
      ['ED A0 80', Uint8Array.of(0x61, 0x3a, 0x20, 0xed, 0xa0, 0x80, 0x0a)],
    ]
    for (const [what, bytes] of unreadable) {
      expect.soft(readWorkflow(bytes).ok, `(g12) W-read: ${what}`).toBe(false)
    }
    expect
      .soft(
        readWorkflow(encode(SCAFFOLD.replaceAll('\n', '\r\n'))),
        '(g12) a CRLF text reads as its LF text',
      )
      .toEqual({ ok: true, text: SCAFFOLD })
    refuses('g12', 'W-tab', ['x:\ty', `run: |\n  echo\tok`])
    // g13: W-set (MW16-20, MW16-20b).
    const seven = SEVEN.map((name) => ({ name, file: true }))
    expect.soft(setFindings(seven), '(g13) the seven files: clean').toEqual([])
    for (const extra of [
      { name: 'x.yml', file: true },
      { name: 'X.YML', file: true },
      { name: 'ci.yaml', file: true },
      { name: 'ci.yml.bak', file: true },
      { name: 'sub', file: false },
    ]) {
      expect
        .soft(setFindings([...seven, extra]).length, `(g13) W-set: ${JSON.stringify(extra)}`)
        .toBeGreaterThan(0)
    }
    expect.soft(setFindings([]).length, '(g13) W-set: an empty listing').toBeGreaterThan(0)
    // g14: the publisher-structure reader (MW16-21).
    const golden = goldenText('approve')
    expect(
      placementFindings('approve', golden),
      "precondition: approve's golden text has no placement finding",
    ).toEqual([])
    const secretX = `${expr('secrets.X')}`
    const misplaced: readonly (readonly [string, string, string])[] = [
      [
        'a secret in the fixtures job',
        '      - name: Publisher approve on the fixture store\n',
        `      - name: Publisher approve on the fixture store\n        env:\n          X: ${secretX}\n`,
      ],
      [
        "a secret at the storage job's level",
        '    environment: publisher\n',
        `    environment: publisher\n    env:\n      X: ${secretX}\n`,
      ],
      [
        "a secret in the install step's env",
        `      - run: ${INSTALL}\n      - name: Publisher approve against`,
        `      - run: ${INSTALL}\n        env:\n          X: ${secretX}\n      - name: Publisher approve against`,
      ],
      [
        'a vars line in refuse-ref',
        '    timeout-minutes: 2\n',
        `    timeout-minutes: 2\n    env:\n      Y: ${expr('vars.Y')}\n`,
      ],
    ]
    for (const [what, find, replace] of misplaced) {
      const text = golden.replace(find, replace)
      expect(text !== golden, `precondition: the ${what} sample differs from the golden text`).toBe(
        true,
      )
      expect.soft(placementFindings('approve', text).length, `(g14) ${what}`).toBeGreaterThan(0)
    }
    // g15: run-name in any spelling and any file (MW16-49, MW16-49b).
    const runNames = ['run-name: x', '"run-name": x', 'run-name : x', `run-name: Deploy ${x}`]
    refuses('g15', 'W-run-name', runNames)
    refuses('g15', 'W-run-name', runNames, 'publisher-approve.yml')
    clean('g15', ['run: echo run-name'])
  })

  it("T16-10 ci.yml's push and pull_request paths are equal and equal the eight-item list (A8, D16-20, SEC3-5)", () => {
    const lists = pathsListsOf(workflowText('ci.yml') ?? '')
    expect(
      [lists.push?.length ?? 0, lists.pullRequest?.length ?? 0].map((length) => length > 0),
      'precondition: both paths: blocks found, each with at least one item',
    ).toEqual([true, true])
    // g1 (MU16-71 first half, MU16-72 second half).
    expect
      .soft(lists.push, '(g1) the push and pull_request lists are equal')
      .toEqual(lists.pullRequest)
    expect
      .soft([lists.push, lists.pullRequest], '(g1) both equal the eight-item list')
      .toEqual([EIGHT, EIGHT])
    // g2: the reader (MW16-22, MW16-38, MW16-39).
    const on = (push: string) =>
      `on:\n  push:\n${push}  pull_request:\n    paths:\n      - 'a/**'\n`
    expect
      .soft(
        pathsListsOf(
          on("    paths:\n      - 'a/**' # note\n      # - 'docs/**'\n      - 'b/**'\n"),
        ),
        '(g2) a commented-out line is no item; a trailing comment is stripped',
      )
      .toEqual({ push: ["'a/**'", "'b/**'"], pullRequest: ["'a/**'"] })
    expect
      .soft(
        pathsListsOf(on("    paths-ignore:\n      - 'x/**'\n    paths:\n      - 'a/**'\n")),
        '(g2) a paths-ignore: list is not read',
      )
      .toEqual({ push: ["'a/**'"], pullRequest: ["'a/**'"] })
    expect
      .soft(
        pathsListsOf(on("    paths:\n      - 'a/**'\n    branches:\n      - x\n")),
        '(g2) the list ends at the first line at or below paths:',
      )
      .toEqual({ push: ["'a/**'"], pullRequest: ["'a/**'"] })
  })

  it(
    'T16-11 the runbook names every value and the Environment, holds no secret shape in raw, %XX-decoded or JSON-unescaped form, its fixture table equals fixtureFacts and plans through the helper to the M-rows, §8 rotates before deleting logs, and the safety phrases are present (A22, CRIT-15, AUD-6, AUD-7)',
    TIMEOUT,
    async () => {
      const text = runbookText()
      const sections = sectionsOf(text)
      expect(
        [text.length >= 2000, [...sections.keys()]],
        'precondition: docs/runbooks/key-rotation.md reads as UTF-8, holds at least 2,000 characters and sections 1 to 11 in order',
      ).toEqual([true, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]])
      const plain = text.replaceAll('`', '')
      // g1: the names (MU16-73).
      for (const name of NAMES) expect.soft(text.includes(name), `(g1) names ${name}`).toBe(true)
      expect
        .soft(plain.includes('Environment publisher'), '(g1) names the Environment publisher')
        .toBe(true)
      // g2: no secret shape in any form (MU16-74; the scanner: MW16-23 to -25, MW16-40 to -47).
      expect.soft(shapeFindings(text), '(g2) the runbook holds no secret shape').toEqual([])
      const host = 'abcdefghijklmnopqrst'
      const hook = ['api.vercel.com', 'v1', 'integrations', 'deploy', 'abc']
      const shaped: readonly string[] = [
        ['sb', 'secret'].join('_'),
        `${['sb', 'publishable', ''].join('_')}abcdef`,
        `${'ey'}Jabcdefghij`,
        hook.join('/'),
        `${'hf'}_abcdefghij`,
        `postgresql${':'}//x`,
        `${host}.supabase.co`,
        `storage${'//'}v1`,
        `api${'key'}: x`,
        `"api${'key'}" = x`,
        `${'%73'}b_secret`,
        `sb${'\\u005f'}secret`,
        hook.join('\\/'),
        '%ZZ',
        '%E0%A4',
      ]
      for (const sample of shaped) {
        expect
          .soft(shapeFindings(sample).length, `(g2) found: ${JSON.stringify(sample)}`)
          .toBeGreaterThan(0)
      }
      for (const sample of [
        ['sb', 'publishable', ''].join('_'),
        'SUPABASE_SECRET_KEY',
        'postgres',
        'supabase.co',
      ]) {
        expect.soft(shapeFindings(sample), `(g2) clean: ${JSON.stringify(sample)}`).toEqual([])
      }
      // g3: the fixture table equals fixtureFacts() (MU16-75).
      const facts = await fixtureFacts()
      const rows = tableOf(sections.get(10) ?? '')
      expect(
        rows.map(([label]) => label),
        'precondition: section 10 holds the 12 labelled rows of the fixture table, in order',
      ).toEqual(TABLE_LABELS)
      const values = [
        facts.approve.storyId,
        facts.approve.packagePrefix,
        ...ANSWER_KEYS.map((key) => facts.approve.answers[key]),
        facts.publish.storyIds,
        facts.feature.storyId,
        facts.rollback.snapshot,
        facts.unpublish.storyId,
      ]
      expect
        .soft(
          rows.map(([, value]) => value),
          '(g3) each table value equals fixtureFacts()',
        )
        .toEqual(values)
      // g4: section 8 revokes or rotates before Delete all logs (MU16-76).
      const leak = sections.get(8) ?? ''
      const revoke = leak.search(/\b(?:revoke|rotate)/i)
      const remove = leak.indexOf('Delete all logs')
      expect
        .soft(
          [revoke >= 0, remove >= 0, revoke < remove],
          '(g4) section 8: revoke or rotate first, then Delete all logs',
        )
        .toEqual([true, true, true])
      // g5: the required phrases (MU16-165 to MU16-172).
      for (const [phrase, anyCase] of PHRASES) {
        const found = anyCase
          ? plain.toLowerCase().includes(phrase.toLowerCase())
          : plain.includes(phrase)
        expect.soft(found, `(g5) the phrase ${JSON.stringify(phrase)}`).toBe(true)
      }
      // g6: the owner's fixtures dispatches plan to the M-rows' argv (MU16-173, MU16-174, MU16-174b).
      const table = new Map(rows)
      const valueOf = (label: string) => table.get(label) ?? ''
      const owner: readonly {
        readonly step: string
        readonly workflow: Workflow
        readonly inputs: Readonly<Record<string, unknown>>
        readonly argv: readonly string[]
      }[] = [
        {
          step: 'step 1, M7',
          workflow: 'verify',
          inputs: { mode: 'fixtures' },
          argv: ['verify', '--fixtures'],
        },
        {
          step: 'step 3, M8',
          workflow: 'verify',
          inputs: { mode: 'fixtures', deep: true },
          argv: ['verify', '--deep', '--fixtures'],
        },
        {
          step: 'step 4, M2',
          workflow: 'publish',
          inputs: { mode: 'fixtures', 'story-ids': valueOf('publish story-ids') },
          argv: ['publish', 'river-stones', '--dry-run', '--fixtures'],
        },
        {
          step: 'step 5, M3',
          workflow: 'publish',
          inputs: { mode: 'fixtures', feature: valueOf('publish feature') },
          argv: ['publish', '--feature', 'two-paths', '--dry-run', '--fixtures'],
        },
        {
          step: 'step 6, M4',
          workflow: 'publish',
          inputs: { mode: 'fixtures', snapshot: valueOf('publish snapshot') },
          argv: ['publish', '--snapshot', '1', '--dry-run', '--fixtures'],
        },
        {
          step: 'step 7, M5',
          workflow: 'unpublish',
          inputs: { mode: 'fixtures', 'story-id': valueOf('unpublish story-id') },
          argv: ['publish', '--unpublish', 'river-stones', '--dry-run', '--fixtures'],
        },
        {
          step: 'step 8, M1',
          workflow: 'approve',
          inputs: {
            mode: 'fixtures',
            'story-id': valueOf('approve story-id'),
            'package-prefix': valueOf('approve package-prefix'),
            ...Object.fromEntries(ANSWER_KEYS.map((key) => [key, valueOf(key)])),
          },
          argv: [
            'approve',
            'lantern-walk',
            '--package',
            facts.approve.packagePrefix,
            '--answers-stdin',
            '--dry-run',
            '--fixtures',
          ],
        },
      ]
      const plans = owner.map(({ workflow, inputs }) => ownerPlan(workflow, inputs))
      expect(
        plans.map((plan) => plan.ok),
        'precondition: the seven owner fixtures dispatches plan ok through the helper',
      ).toEqual(owner.map(() => true))
      for (const [index, { step, argv }] of owner.entries()) {
        const plan = plans[index]
        expect
          .soft(plan?.ok === true ? plan.argv : null, `(g6) ${step}: the M-row's argv`)
          .toEqual(argv)
      }
      const approve = plans.at(-1)
      const stdin =
        approve?.ok === true && approve.stdin !== null
          ? (JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(approve.stdin)) as Record<
              string,
              unknown
            >)
          : null
      expect
        .soft(
          stdin === null ? null : Object.entries(stdin),
          "(g6) step 8: stdin decodes to the table's six answers in ANSWER_KEYS order",
        )
        .toEqual(ANSWER_KEYS.map((key) => [key, valueOf(key)]))
    },
  )
})
