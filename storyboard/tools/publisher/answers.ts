// The approve answer channel (design migration-input/p1-step15a-design.md §3.3, D15-3, CRIT-10,
// CRIT-15, TP-3; P1-8d part a, Step 15a). Two channels give the same six answers:
// - `--answers-stdin`: one JSON object on stdin, at most ANSWERS_MAX_BYTES, before a deadline,
//   strict UTF-8 (a leading BOM is kept, so JSON refuses it), one optional trailing \n or \r\n, a
//   plain object of exactly the six keys, each a string, no own __proto__ key and no top-level member
//   name twice (names compared after JSON-decoding). The input is destroyed on the cap, the deadline
//   or a stream error, so an open pipe never keeps the process alive.
// - prompts (this PC, stdin a TTY): six fixed questions with public facts only, written through the
//   caller's `write`, read with one node:readline iterator (PB1); readline is closed at either end.
// reviewFromAnswers is the one parser: a value failing its form is answers-invalid; a well-formed
// value that does not confirm the full review is approval-review-incomplete. A refusal names the
// key, never a value. Imports src/core and node:readline only; never names the process or prints.
import { createInterface } from 'node:readline'
import { isLocaleCode, type LocaleCode } from '../../src/core/locales'
import {
  APPROVAL_CHECKLIST_TEXT,
  DEVICE_TEXT_MAX,
  isReviewText,
  REVIEW_TEXT_MAX,
  type ApprovalReview,
} from '../../src/core/package/approval'

/** The six answer keys, in prompt order. */
export const ANSWER_KEYS = [
  'languages-read',
  'all-nodes-read',
  'images-viewed',
  'narration-check',
  'devices',
  'checklist-complete',
] as const
export type AnswerKey = (typeof ANSWER_KEYS)[number]

/** The largest stdin body: 16,384 bytes accepted, 16,385 refused. */
export const ANSWERS_MAX_BYTES = 16_384
/** The most devices a review may name (ApprovalReview). */
const DEVICES_MAX = 8
/** images-viewed: a count from 0 to 64 without a leading zero. */
const IMAGE_COUNT = /^(0|[1-9][0-9]?)$/
const IMAGES_MAX = 64

/** stdin or a test stream: a readable that can be destroyed. */
export type AnswerInput = NodeJS.ReadableStream & { destroy(error?: Error): unknown }
export type Answers = ReadonlyMap<string, string>

export type StdinAnswers =
  | { readonly ok: true; readonly answers: Answers }
  | { readonly ok: false; readonly code: 'answers-invalid' }

export type PromptedAnswers =
  | { readonly ok: true; readonly answers: Answers }
  | { readonly ok: false; readonly code: 'answers-missing' }

/** The public facts of the reviewed package (D15-25): ids, hashes, counts. */
export interface ReviewFacts {
  readonly storyId: string
  readonly packageSha256: string
  readonly version: number
  readonly locales: readonly LocaleCode[]
  readonly nodeCount: number
  /** Nodes whose `image` is not null. */
  readonly imageCount: number
}

export type ReviewResult =
  | { readonly ok: true; readonly review: ApprovalReview }
  | {
      readonly ok: false
      readonly code: 'answers-invalid' | 'approval-review-incomplete'
      readonly key: AnswerKey
    }

const INVALID: StdinAnswers = { ok: false, code: 'answers-invalid' }

/**
 * The member names of a top-level JSON object, each JSON-decoded, in text order; null when a name
 * does not decode. `text` is valid JSON whose top level is an object (JSON.parse accepted it).
 */
function topLevelNames(text: string): string[] | null {
  const names: string[] = []
  let depth = 0
  let expectName = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      if (depth === 1 && expectName) {
        let name: unknown
        try {
          name = JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
        if (typeof name !== 'string') return null
        names.push(name)
        expectName = false
      }
    } else if (c === '{' || c === '[') {
      depth++
      if (depth === 1) expectName = c === '{'
    } else if (c === '}' || c === ']') {
      depth--
    } else if (c === ',' && depth === 1) {
      expectName = true
    }
  }
  return names
}

/** The whole stdin body to the six answers, or answers-invalid. */
function parseAnswers(bytes: Uint8Array): StdinAnswers {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return INVALID
  }
  if (text.endsWith('\r\n')) text = text.slice(0, -2)
  else if (text.endsWith('\n')) text = text.slice(0, -1)
  if (!text.startsWith('{') || !text.endsWith('}')) return INVALID
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return INVALID
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return INVALID
  if (Object.hasOwn(value, '__proto__')) return INVALID
  const names = topLevelNames(text)
  if (names === null || new Set(names).size !== names.length) return INVALID
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== ANSWER_KEYS.length || !ANSWER_KEYS.every((key) => Object.hasOwn(record, key)))
    return INVALID
  const answers = new Map<string, string>()
  for (const key of ANSWER_KEYS) {
    const answer = record[key]
    if (typeof answer !== 'string') return INVALID
    answers.set(key, answer)
  }
  return { ok: true, answers }
}

/**
 * Reads `input` to its end, at most ANSWERS_MAX_BYTES, before `deadline`, then parses it. On the cap,
 * the deadline or a stream error the input is destroyed and the call settles at once with
 * answers-invalid; an error's message is never kept.
 */
export function readAnswersStream(
  input: AnswerInput,
  deadline: Promise<void>,
): Promise<StdinAnswers> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false
    const settle = (result: StdinAnswers, destroy: boolean) => {
      if (settled) return
      settled = true
      input.removeListener('data', onData)
      input.removeListener('end', onEnd)
      if (destroy) input.destroy()
      resolve(result)
    }
    const onData = (chunk: unknown) => {
      const bytes =
        typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
          : chunk instanceof Uint8Array
            ? chunk
            : null
      if (bytes === null) return settle(INVALID, true)
      total += bytes.byteLength
      if (total > ANSWERS_MAX_BYTES) return settle(INVALID, true)
      chunks.push(bytes)
    }
    const onEnd = () => {
      const body = new Uint8Array(total)
      let at = 0
      for (const chunk of chunks) {
        body.set(chunk, at)
        at += chunk.byteLength
      }
      settle(parseAnswers(body), false)
    }
    // Kept after settling, so a late error is swallowed rather than thrown.
    const onError = () => settle(INVALID, true)
    input.on('error', onError)
    input.on('data', onData)
    input.on('end', onEnd)
    deadline.then(
      () => settle(INVALID, true),
      () => settle(INVALID, true),
    )
  })
}

/** The fixed question for a key, with public facts only (TP-3). */
function questionOf(key: AnswerKey, facts: ReviewFacts): string {
  switch (key) {
    case 'languages-read':
      return `languages-read: which languages did you read in full? (this package: ${facts.locales.join(',')})`
    case 'all-nodes-read':
      return `all-nodes-read: did you read all ${facts.nodeCount} nodes in every language? (yes/no)`
    case 'images-viewed':
      return `images-viewed: how many pictures did you view? (this package: ${facts.imageCount})`
    case 'narration-check':
      return 'narration-check: what did you check in the narration? (one line)'
    case 'devices':
      return 'devices: which devices did you review on? (comma-separated)'
    case 'checklist-complete':
      return 'checklist-complete: is every Flow Guide v1.0 checklist item ticked? (yes/no)'
  }
}

/**
 * Six questions, one `write` call each ending in one space, each answered by one line of `input`
 * (CRLF accepted). An end of input before the sixth answer is answers-missing. One readline iterator
 * is created at once and readline is closed at either end.
 */
export async function promptAnswers(
  input: AnswerInput,
  write: (text: string) => void,
  facts: ReviewFacts,
): Promise<PromptedAnswers> {
  const rl = createInterface({ input, terminal: false, crlfDelay: Infinity })
  const lines = rl[Symbol.asyncIterator]()
  try {
    const answers = new Map<string, string>()
    for (const key of ANSWER_KEYS) {
      write(`${questionOf(key, facts)} `)
      const next = await lines.next()
      if (next.done === true) return { ok: false, code: 'answers-missing' }
      answers.set(key, String(next.value))
    }
    return { ok: true, answers }
  } finally {
    rl.close()
  }
}

/** A comma-separated list, each item trimmed of spaces; null when any item is empty. */
function listItems(value: string | undefined): string[] | null {
  if (value === undefined) return null
  const items = value.split(',').map((item) => item.replace(/^ +| +$/g, ''))
  return items.some((item) => item === '') ? null : items
}

/** `yes` → true, `no` → false, anything else (case, spaces) → null. */
const yesNo = (value: string | undefined): boolean | null =>
  value === 'yes' ? true : value === 'no' ? false : null

const unique = (list: readonly string[]): boolean => new Set(list).size === list.length

/**
 * The review from the six answers and the package's facts: every form first, in key order
 * (answers-invalid), then the confirmations, in key order (approval-review-incomplete). languagesRead
 * is written in package order, whatever the answer's order.
 */
export function reviewFromAnswers(answers: Answers, facts: ReviewFacts): ReviewResult {
  const invalid = (key: AnswerKey): ReviewResult => ({ ok: false, code: 'answers-invalid', key })
  const incomplete = (key: AnswerKey): ReviewResult => ({
    ok: false,
    code: 'approval-review-incomplete',
    key,
  })
  const languages = listItems(answers.get('languages-read'))
  if (languages === null || !languages.every(isLocaleCode) || !unique(languages)) {
    return invalid('languages-read')
  }
  const allNodes = yesNo(answers.get('all-nodes-read'))
  if (allNodes === null) return invalid('all-nodes-read')
  const imagesText = answers.get('images-viewed')
  if (
    imagesText === undefined ||
    !IMAGE_COUNT.test(imagesText) ||
    Number(imagesText) > IMAGES_MAX
  ) {
    return invalid('images-viewed')
  }
  const images = Number(imagesText)
  const narration = answers.get('narration-check')
  if (!isReviewText(narration, REVIEW_TEXT_MAX)) return invalid('narration-check')
  const devices = listItems(answers.get('devices'))
  if (
    devices === null ||
    devices.length > DEVICES_MAX ||
    !devices.every((device) => isReviewText(device, DEVICE_TEXT_MAX)) ||
    !unique(devices)
  ) {
    return invalid('devices')
  }
  const checklist = yesNo(answers.get('checklist-complete'))
  if (checklist === null) return invalid('checklist-complete')

  const packageLocales = new Set<string>(facts.locales)
  if (
    languages.length !== packageLocales.size ||
    !languages.every((locale) => packageLocales.has(locale))
  ) {
    return incomplete('languages-read')
  }
  if (!allNodes) return incomplete('all-nodes-read')
  if (images !== facts.imageCount) return incomplete('images-viewed')
  if (!checklist) return incomplete('checklist-complete')
  return {
    ok: true,
    review: {
      languagesRead: [...facts.locales],
      allNodesRead: true,
      imagesViewed: images,
      narrationCheck: narration,
      devices,
      reviewerChecklist: APPROVAL_CHECKLIST_TEXT,
    },
  }
}
