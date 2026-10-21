// Pure text helpers for validator checks.

export function wordCount(s: string): number {
  const t = s.trim()
  return t === '' ? 0 : t.split(/\s+/u).length
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/u
const BIDI_OVERRIDE = /[‪-‮⁦-⁩]/u
const HTML_OR_URL = /<\/?[a-z][^>]*>|https?:\/\/|www\./iu

export function textHygiene(s: string): { checkId: string; message: string }[] {
  const out: { checkId: string; message: string }[] = []
  if (s !== s.normalize('NFC')) out.push({ checkId: 'T001', message: 'Text is not Unicode NFC' })
  if (CONTROL.test(s) || BIDI_OVERRIDE.test(s))
    out.push({ checkId: 'T002', message: 'Control or bidi-override character' })
  if (s !== s.trim()) out.push({ checkId: 'T003', message: 'Leading or trailing whitespace' })
  if ((s.match(/\*/gu)?.length ?? 0) % 2 !== 0)
    out.push({ checkId: 'T004', message: 'Unbalanced *emphasis* asterisks' })
  if (HTML_OR_URL.test(s)) out.push({ checkId: 'T005', message: 'HTML or URL in text' })
  return out
}

const QUOTES = /["“”]/gu

/**
 * E014: the last line STARTING with the marker must be followed by exactly one quoted block and
 * nothing else (line-start rule, OD-17/OD-18). Returns null when the teaching line is valid.
 */
export function teachingProblem(text: string, marker: string): string | null {
  const lines = text.split('\n')
  let idx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] ?? '').startsWith(marker)) {
      idx = i
      break
    }
  }
  if (idx === -1) return 'No line starts with the teaching marker'
  const rest = [(lines[idx] ?? '').slice(marker.length), ...lines.slice(idx + 1)].join('\n').trim()
  if (rest === '') return 'Teaching marker is not followed by a quoted teaching'
  const quotes = rest.match(QUOTES)?.length ?? 0
  if (!/^["“]/u.test(rest) || !/["”]$/u.test(rest) || quotes !== 2) {
    return 'Teaching is not one quoted block ending the text'
  }
  return null
}

/** E005: exactly one question mark from the locale's set, and it ends the string. */
export function questionProblem(q: string, marks: readonly string[]): string | null {
  const count = [...q].filter((ch) => marks.includes(ch)).length
  const last = [...q.trimEnd()].pop() ?? ''
  if (count !== 1) return `${count} question marks (exactly 1 expected)`
  if (!marks.includes(last)) return 'The question mark does not end the question'
  return null
}

export function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu').test(haystack)
}
