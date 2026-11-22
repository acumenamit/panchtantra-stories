// Step 15a (P1-8d part a): the approve answer channel (design migration-input/p1-step15a-design.md
// §3.3 D15-3, §9 L2, §14.6 T15A-15 to T15A-18). One JSON object on stdin, or six prompts over
// node:readline; one parser for both. Streams are in-memory Readables; no process stream is read and
// nothing is printed. Titles start with their id; one expect.soft per claim, messages
// "(gN) <claim> <sample>"; preconditions are hard expects starting "precondition:".
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { APPROVAL_CHECKLIST_TEXT } from '../../src/core/package/approval'
import {
  ANSWER_KEYS,
  ANSWERS_MAX_BYTES,
  promptAnswers,
  readAnswersStream,
  reviewFromAnswers,
  type ReviewFacts,
} from './answers'

const CANARY_N = 'S15ACANARYnarration'
const CANARY_D = 'S15ACANARYdevice'
const NEVER = new Promise<void>(() => {})
const encode = (text: string) => new TextEncoder().encode(text)
const INVALID = { ok: false, code: 'answers-invalid' }

/** The six answers as an ordered object; canary free text by default. */
const answerObject = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'languages-read': 'en,hi',
  'all-nodes-read': 'yes',
  'images-viewed': '1',
  'narration-check': CANARY_N,
  devices: CANARY_D,
  'checklist-complete': 'yes',
  ...over,
})
const bodyText = (over: Record<string, unknown> = {}) => JSON.stringify(answerObject(over))
const streamOf = (...chunks: (string | Uint8Array)[]) => Readable.from(chunks)
const read = (...chunks: (string | Uint8Array)[]) => readAnswersStream(streamOf(...chunks), NEVER)
const settled = <T>(promise: Promise<T>) =>
  Promise.race([
    promise.then((value) => ({ value })),
    new Promise<'pending'>((done) => setImmediate(() => done('pending'))),
  ])

const FACTS: ReviewFacts = {
  storyId: 'two-paths',
  packageSha256: 'c'.repeat(64),
  version: 2,
  locales: ['en', 'hi'],
  nodeCount: 5,
  imageCount: 1,
}
const QUESTIONS = [
  'languages-read: which languages did you read in full? (this package: en,hi) ',
  'all-nodes-read: did you read all 5 nodes in every language? (yes/no) ',
  'images-viewed: how many pictures did you view? (this package: 1) ',
  'narration-check: what did you check in the narration? (one line) ',
  'devices: which devices did you review on? (comma-separated) ',
  'checklist-complete: is every Flow Guide v1.0 checklist item ticked? (yes/no) ',
]
const answersMap = (over: Record<string, string> = {}) =>
  new Map<string, string>(
    Object.entries({
      'languages-read': 'en,hi',
      'all-nodes-read': 'yes',
      'images-viewed': '1',
      'narration-check': 'checked',
      devices: 'phone, laptop',
      'checklist-complete': 'yes',
      ...over,
    }),
  )

describe('answers (Step 15a)', () => {
  it('T15A-15 readAnswersStream: one JSON object of exactly the six string keys, strict UTF-8, at most 16,384 bytes, one optional trailing newline (A5, L2, CRIT-15)', async () => {
    const pre = await read(bodyText())
    expect(pre.ok, 'precondition: a valid body in one chunk is accepted').toBe(true)
    expect(pre.ok ? [...pre.answers.keys()] : [], 'precondition: the six keys, in order').toEqual([
      ...ANSWER_KEYS,
    ])
    // (g1) accepted
    const devanagari = encode(bodyText({ 'narration-check': 'नमस्ते जाँचा' }))
    const cut = devanagari.indexOf(0xe0) + 1
    expect(cut > 1 && devanagari[cut] !== undefined, 'precondition: a cut inside a character').toBe(
      true,
    )
    const base = bodyText()
    const padded = (total: number) => `{${' '.repeat(total - base.length)}${base.slice(1)}`
    expect(encode(padded(ANSWERS_MAX_BYTES)).byteLength, 'precondition: exactly the cap').toBe(
      16_384,
    )
    const accepted: [string, (string | Uint8Array)[]][] = [
      ['with \\n', [`${base}\n`]],
      ['with \\r\\n', [`${base}\r\n`]],
      ['with neither', [base]],
      [
        'three chunks cutting a Devanagari character',
        [devanagari.slice(0, cut), devanagari.slice(cut, cut + 7), devanagari.slice(cut + 7)],
      ],
      ['padded with JSON spaces to exactly 16,384 bytes', [padded(ANSWERS_MAX_BYTES)]],
    ]
    for (const [name, chunks] of accepted) {
      const result = await read(...chunks)
      expect.soft(result.ok, `(g1) accepted ${name}`).toBe(true)
    }
    // (g2) refused, (g3) exactly the fixed refusal with no value
    const sixPlusDuplicate = `${base.slice(0, -1)},"devices":"${CANARY_D}2"}`
    const escapedDuplicate = `${base.slice(0, -1)},"devic\\u0065s":"${CANARY_D}2"}`
    const invalidUtf8 = encode(bodyText({ devices: `${CANARY_D}#` }))
    invalidUtf8[invalidUtf8.indexOf(0x23)] = 0xff
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(base)])
    const protoBody = base.replace('{', '{"__proto__":"x",')
    const refused: [string, (string | Uint8Array)[]][] = [
      ['16,385 bytes', [padded(ANSWERS_MAX_BYTES + 1)]],
      ['0xff inside a string', [invalidUtf8]],
      ['[]', ['[]']],
      ['null', ['null']],
      ['"x"', ['"x"']],
      ['seven keys', [bodyText({ extra: CANARY_N })]],
      ['five keys', [JSON.stringify({ ...answerObject(), 'checklist-complete': undefined })]],
      ['a number value', [bodyText({ 'images-viewed': 1 })]],
      ['an object value', [bodyText({ devices: { name: CANARY_D } })]],
      ['an own __proto__ key', [protoBody]],
      ['two trailing newlines', [`${base}\n\n`]],
      ['a lone trailing \\r', [`${base}\r`]],
      ['a leading UTF-8 BOM', [bom]],
      ['a duplicate member name among six distinct ones', [sixPlusDuplicate]],
      ['a duplicate written as "devic\\u0065s"', [escapedDuplicate]],
    ]
    expect(
      JSON.parse(sixPlusDuplicate) as object,
      'precondition: JSON.parse keeps one devices',
    ).toHaveProperty('devices', `${CANARY_D}2`)
    for (const [name, chunks] of refused) {
      const result = await read(...chunks)
      expect.soft(result.ok, `(g2) refused ${name}`).toBe(false)
      expect.soft(result, `(g3) the fixed refusal ${name}`).toStrictEqual(INVALID)
      expect
        .soft(JSON.stringify(result).includes('S15ACANARY'), `(g3) no value in the result ${name}`)
        .toBe(false)
    }
  })

  it('T15A-16 readAnswersStream ends and destroys its input at the deadline, past the cap and on a stream error (A5, CRIT-10)', async () => {
    const open = () => {
      const input = new Readable({ read() {} })
      input.push('{')
      return input
    }
    const pre = open()
    expect(pre.destroyed, 'precondition: an open stream is not destroyed before the call').toBe(
      false,
    )
    pre.destroy()
    // (g1) the deadline
    let release = () => {}
    const deadline = new Promise<void>((done) => (release = done))
    const waiting = open()
    const pending = readAnswersStream(waiting, deadline)
    expect(await settled(pending), 'precondition: pending before the deadline').toBe('pending')
    release()
    const atDeadline = await settled(pending)
    expect
      .soft(atDeadline, '(g1) settled within one turn after the deadline: answers-invalid')
      .toStrictEqual({ value: INVALID })
    expect.soft(waiting.destroyed, '(g1) destroyed at the deadline').toBe(true)
    // (g2) past the cap on a never-ending stream (it stops pushing after 64 chunks, so a run that
    // keeps reading ends instead of starving the event loop; it never ends)
    let reads = 0
    const flood = new Readable({
      highWaterMark: 4096,
      read() {
        reads++
        if (reads <= 64) this.push(new Uint8Array(4096).fill(0x20))
      },
    })
    const capped = await readAnswersStream(flood, NEVER)
    const readsAtResult = reads
    expect.soft(capped, '(g2) past the cap: answers-invalid').toStrictEqual(INVALID)
    expect.soft(flood.destroyed, '(g2) destroyed past the cap').toBe(true)
    await new Promise((done) => setTimeout(done, 20))
    expect.soft(reads, '(g2) no further chunk read after the result').toBe(readsAtResult)
    // 5 chunks pass the cap; the stream reads at most one chunk ahead of the one it delivers
    expect
      .soft(readsAtResult, '(g2) no chunk read past the one ahead of the cap')
      .toBeLessThanOrEqual(6)
    expect.soft(readsAtResult * 4096 > ANSWERS_MAX_BYTES, '(g2) the cap was passed').toBe(true)
    // (g3) a stream error holding a canary
    const failing = open()
    const result = readAnswersStream(failing, NEVER)
    failing.emit('error', new Error(`S15ACANARY ${CANARY_N}`))
    const errored = await result
    expect.soft(errored, '(g3) an error: answers-invalid').toStrictEqual(INVALID)
    expect.soft(failing.destroyed, '(g3) destroyed on the error').toBe(true)
    expect
      .soft(JSON.stringify(errored).includes('S15ACANARY'), '(g3) no canary in the result')
      .toBe(false)
  })

  it('T15A-17 promptAnswers: six fixed questions with public facts only, one line each, CRLF accepted, an early end is answers-missing, readline closed (A5, PB1, D15-25)', async () => {
    expect(FACTS.locales, 'precondition: facts en/hi, 5 nodes, 1 image').toEqual(['en', 'hi'])
    // (g1) CRLF lines across a chunk boundary
    const written: string[] = []
    const ok = await promptAnswers(
      streamOf('en,hi\r\nyes\r\n1\r\n', 'checked\r\nphone, laptop\r\nyes\r\n'),
      (text) => written.push(text),
      FACTS,
    )
    expect
      .soft(ok.ok ? Object.fromEntries(ok.answers) : ok, '(g1) the six-key Map')
      .toEqual(Object.fromEntries(answersMap()))
    expect
      .soft(written, '(g1) six promptWrite calls with the fixed texts in order')
      .toEqual(QUESTIONS)
    // (g2) five lines then the end
    const early = streamOf('en,hi\nyes\n1\nchecked\nphone\n')
    const missing = await promptAnswers(early, () => {}, FACTS)
    expect
      .soft(missing, '(g2) answers-missing')
      .toStrictEqual({ ok: false, code: 'answers-missing' })
    // (g3) readline's listeners gone after either end; the open input proves rl.close()
    const open = new Readable({ read() {} })
    open.push(`en,hi\nyes\n1\n${CANARY_N}\n${CANARY_D}\nyes\n`)
    const fromOpen = await promptAnswers(open, () => {}, FACTS)
    expect(fromOpen.ok, 'precondition: six answers from an input that never ends').toBe(true)
    expect.soft(open.listenerCount('data'), '(g3) no data listener after six answers').toBe(0)
    expect.soft(early.listenerCount('data'), '(g3) no data listener after an early end').toBe(0)
    open.destroy()
    // (g4) no prompt text holds an answer
    const canaryWrites: string[] = []
    const canary = new Readable({ read() {} })
    canary.push(`en,hi\nyes\n1\n${CANARY_N}\n${CANARY_D}\nyes\n`)
    const canaryRun = await promptAnswers(canary, (text) => canaryWrites.push(text), FACTS)
    expect(canaryRun.ok, 'precondition: the canary answers were read').toBe(true)
    expect
      .soft(canaryWrites.join('').includes('S15ACANARY'), '(g4) no answer in any prompt')
      .toBe(false)
    canary.destroy()
  })

  it('T15A-18 reviewFromAnswers: form errors are answers-invalid naming the key; well-formed answers that do not confirm the review are approval-review-incomplete; the review object (A5, L2)', () => {
    expect(reviewFromAnswers(answersMap(), FACTS).ok, 'precondition: confirming answers').toBe(true)
    // (g1) accepted
    const accepted: [string, Record<string, string>, ReviewFacts][] = [
      ["' en , hi '", { 'languages-read': ' en , hi ' }, FACTS],
      ["'hi,en' (a set)", { 'languages-read': 'hi,en' }, FACTS],
      ["devices ' phone , laptop '", { devices: ' phone , laptop ' }, FACTS],
      [
        "images '0' for a package without pictures",
        { 'images-viewed': '0' },
        { ...FACTS, imageCount: 0 },
      ],
    ]
    for (const [name, over, facts] of accepted) {
      expect.soft(reviewFromAnswers(answersMap(over), facts).ok, `(g1) accepted ${name}`).toBe(true)
    }
    // (g2) answers-invalid with the key
    const nine = 'a,b,c,d,e,f,g,h,i'
    const invalid: [string, string][] = [
      ...['all-nodes-read', 'checklist-complete'].flatMap((key) =>
        ['YES', 'Yes', 'yes '].map((value): [string, string] => [key, value]),
      ),
      ['languages-read', 'en,,hi'],
      ['languages-read', 'fr'],
      ['languages-read', 'en,en'],
      ['images-viewed', '013'],
      ['images-viewed', '65'],
      ['images-viewed', '1e1'],
      ['images-viewed', '-1'],
      ['images-viewed', ''],
      ['devices', 'a,,b'],
      ['devices', 'a,a'],
      ['devices', nine],
      ['devices', 'd'.repeat(81)],
      ['narration-check', 'a‮b'],
      ['narration-check', 'n'.repeat(201)],
      ['narration-check', ''],
      ['narration-check', 'ok\uD800'],
      ['devices', 'phone, a\uDC00b'],
    ]
    for (const [key, value] of invalid) {
      expect
        .soft(
          reviewFromAnswers(answersMap({ [key]: value }), FACTS),
          `(g2) ${key} ${JSON.stringify(value)}`,
        )
        .toStrictEqual({ ok: false, code: 'answers-invalid', key })
    }
    // (g3) approval-review-incomplete with the key
    const incomplete: [string, string, ReviewFacts][] = [
      ['all-nodes-read', 'no', FACTS],
      ['checklist-complete', 'no', FACTS],
      ['languages-read', 'en', FACTS],
      ['languages-read', 'en,hi,ar', FACTS],
      ['images-viewed', '0', FACTS],
    ]
    for (const [key, value, facts] of incomplete) {
      expect
        .soft(reviewFromAnswers(answersMap({ [key]: value }), facts), `(g3) ${key} ${value}`)
        .toStrictEqual({ ok: false, code: 'approval-review-incomplete', key })
    }
    // (g4) the review object, languages in package order
    const built = reviewFromAnswers(answersMap({ 'languages-read': 'hi,en' }), FACTS)
    expect
      .soft(built.ok ? built.review : built, '(g4) the review object after hi,en')
      .toStrictEqual({
        languagesRead: ['en', 'hi'],
        allNodesRead: true,
        imagesViewed: 1,
        narrationCheck: 'checked',
        devices: ['phone', 'laptop'],
        reviewerChecklist: APPROVAL_CHECKLIST_TEXT,
      })
  })
})
