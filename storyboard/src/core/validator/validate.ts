// Validator (spec §5.3): pure, synchronous, never throws. Waivers are applied separately (waivers.ts).
import { getLocaleDef, isEnabledLocale } from '../locales'
import type { LocaleCode } from '../locales'
import { StoryPackageV1 } from '../package/v1'
import type { StoryNode, StoryPackageV1 as Pkg } from '../package/v1'
import type { PrivateRuleData, PublicRuleSet, Severity } from '../rules/types'
import { containsWord, questionProblem, teachingProblem, textHygiene, wordCount } from './text'
import type { Finding, ValidationMode, ValidationReport } from './types'

export interface ValidateOptions {
  readonly ruleSet: PublicRuleSet
  readonly privateData?: PrivateRuleData
  readonly mode?: ValidationMode
  /** A005/A006 are errors only for a story about to be featured. */
  readonly forFeature?: boolean
}

type Add = (
  checkId: string,
  severity: Severity,
  message: string,
  where?: { nodeId?: string | null; locale?: LocaleCode | null; measured?: string; limit?: string },
) => void

export function validatePackage(input: unknown, opts: ValidateOptions): ValidationReport {
  const mode = opts.mode ?? 'authoring'
  const findings: Finding[] = []
  const skipped: { checkId: string; reason: string }[] = []
  const add: Add = (checkId, severity, message, where = {}) =>
    findings.push({
      checkId,
      ruleId: opts.ruleSet.checks[checkId]?.ruleId ?? null,
      severity,
      nodeId: where.nodeId ?? null,
      locale: where.locale ?? null,
      message,
      ...(where.measured !== undefined ? { measured: where.measured } : {}),
      ...(where.limit !== undefined ? { limit: where.limit } : {}),
    })

  let storyId: string | null = null
  try {
    const parsed = StoryPackageV1.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 50)) {
        add('S001', 'error', `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      }
    } else {
      storyId = parsed.data.storyId
      checkGraph(parsed.data, add)
      checkLocales(parsed.data, add, mode)
      checkText(parsed.data, add)
      checkAssets(parsed.data, add, opts.forFeature === true)
      checkEditorial(parsed.data, add, opts.ruleSet)
      checkWordLists(parsed.data, add, opts, skipped)
    }
  } catch (err) {
    add(
      'X000',
      'error',
      `Validator internal error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return {
    storyId,
    ruleSetRef: opts.ruleSet.ref,
    mode,
    ok: !findings.some((f) => f.severity === 'error' && !f.waived),
    findings,
    skipped,
  }
}

const choicesOf = (n: StoryNode) => (n.type === 'ending' ? [] : n.choices)

function checkGraph(p: Pkg, add: Add): void {
  const ids = p.nodes.map((n) => n.id)
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  if (!byId.has(p.startNodeId)) add('G001', 'error', `Start node "${p.startNodeId}" does not exist`)
  if (new Set(ids).size !== ids.length) add('G002', 'error', 'Node ids are not unique')
  for (const n of p.nodes) {
    const cids = choicesOf(n).map((c) => c.id)
    if (new Set(cids).size !== cids.length)
      add('G003', 'error', 'Choice ids repeat', { nodeId: n.id })
    for (const c of choicesOf(n)) {
      if (!byId.has(c.next))
        add('G004', 'error', `Choice ${c.id} leads to missing node "${c.next}"`, { nodeId: n.id })
    }
    // G009: type alternate <=> isAlternate, for non-endings (endings may be isAlternate).
    if (n.type !== 'ending' && (n.type === 'alternate') !== n.isAlternate) {
      add('G009', 'error', `type "${n.type}" disagrees with isAlternate=${n.isAlternate}`, {
        nodeId: n.id,
      })
    }
  }
  if (!byId.has(p.startNodeId)) return

  const reachable = new Set<string>()
  const stack = [p.startNodeId]
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const c of choicesOf(byId.get(id)!)) if (byId.has(c.next)) stack.push(c.next)
  }
  for (const id of ids)
    if (!reachable.has(id)) add('G005', 'error', 'Unreachable from start', { nodeId: id })

  // G007: cycles (iterative DFS with colours).
  const colour = new Map<string, 0 | 1 | 2>()
  let cyclic = false
  for (const root of ids) {
    if (colour.get(root)) continue
    const work: { id: string; i: number }[] = [{ id: root, i: 0 }]
    colour.set(root, 1)
    while (work.length && !cyclic) {
      const top = work[work.length - 1]!
      const next = choicesOf(byId.get(top.id)!)[top.i]
      if (!next) {
        colour.set(top.id, 2)
        work.pop()
        continue
      }
      top.i++
      if (!byId.has(next.next)) continue
      const c = colour.get(next.next) ?? 0
      if (c === 1) cyclic = true
      else if (c === 0) {
        colour.set(next.next, 1)
        work.push({ id: next.next, i: 0 })
      }
    }
  }
  if (cyclic) add('G007', 'error', 'The story graph has a cycle')

  // G006: every node can reach an ending (fixpoint over reverse reachability).
  const canEnd = new Set(p.nodes.filter((n) => n.type === 'ending').map((n) => n.id))
  let changed = true
  while (changed) {
    changed = false
    for (const n of p.nodes) {
      if (!canEnd.has(n.id) && choicesOf(n).some((c) => canEnd.has(c.next))) {
        canEnd.add(n.id)
        changed = true
      }
    }
  }
  for (const id of ids)
    if (!canEnd.has(id)) add('G006', 'error', 'Cannot reach any ending', { nodeId: id })

  // G008: progressSteps exist, are unique, and lie in order on one path from start.
  const steps = p.progressSteps
  if (new Set(steps).size !== steps.length) add('G008', 'error', 'progressSteps repeat a node')
  const reachFrom = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const st = [from]
    while (st.length) {
      const id = st.pop()!
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      const node = byId.get(id)
      if (node) for (const c of choicesOf(node)) st.push(c.next)
    }
    return false
  }
  let prev = p.startNodeId
  for (const s of steps) {
    if (!byId.has(s)) {
      add('G008', 'error', `progressSteps entry "${s}" does not exist`)
      continue
    }
    if (!reachFrom(prev, s))
      add('G008', 'error', `progressSteps entry "${s}" is not on a path after "${prev}"`)
    prev = s
  }
}

function checkLocales(p: Pkg, add: Add, mode: ValidationMode): void {
  for (const l of p.locales) {
    const t = p.text[l]
    if (!t) continue
    if (mode === 'publish' && !isEnabledLocale(l))
      add('G011', 'error', `Locale "${l}" is not enabled`, { locale: l })
    const ids = new Set(p.nodes.map((n) => n.id))
    for (const key of Object.keys(t.nodes))
      if (!ids.has(key)) add('G010', 'error', `Text for unknown node "${key}"`, { locale: l })
    for (const n of p.nodes) {
      const nt = t.nodes[n.id]
      const where = { nodeId: n.id, locale: l }
      if (!nt) {
        add('G010', 'error', 'Missing node text', where)
        continue
      }
      if (n.type === 'ending') {
        if (!nt.lesson) add('G010', 'error', 'Ending has no lesson', where)
        if (nt.question !== undefined || nt.choices !== undefined)
          add('G010', 'error', 'Ending has a question or choice text', where)
      } else {
        if (!nt.question) add('G010', 'error', 'Missing question', where)
        if (nt.lesson !== undefined) add('G010', 'error', 'Non-ending has a lesson', where)
        const want = n.choices.map((c) => c.id).sort()
        const have = Object.keys(nt.choices ?? {}).sort()
        if (want.join() !== have.join())
          add('G010', 'error', `Choice texts ${have} do not match choices ${want}`, where)
      }
    }
  }
}

function checkText(p: Pkg, add: Add): void {
  for (const l of p.locales) {
    const t = p.text[l]
    if (!t) continue
    const fields: [string | null, string][] = [
      [null, t.title],
      [null, t.description],
      [null, t.theme],
      [null, t.duration],
      [null, t.book],
    ]
    for (const [id, nt] of Object.entries(t.nodes)) {
      fields.push([id, nt.text])
      if (nt.question) fields.push([id, nt.question])
      if (nt.lesson) fields.push([id, nt.lesson])
      for (const c of Object.values(nt.choices ?? {})) fields.push([id, c])
    }
    for (const [nodeId, s] of fields)
      for (const h of textHygiene(s)) add(h.checkId, 'error', h.message, { nodeId, locale: l })
  }
}

function checkAssets(p: Pkg, add: Add, forFeature: boolean): void {
  const sev: Severity = forFeature ? 'error' : 'warn'
  const audio = new Set(
    p.assets.filter((a) => a.kind === 'audio').map((a) => `${a.nodeId}|${a.locale}`),
  )
  for (const n of p.nodes) {
    if (n.image === null) add('A006', sev, 'Node has no picture', { nodeId: n.id })
    for (const l of p.locales)
      if (!audio.has(`${n.id}|${l}`)) add('A005', sev, 'No narration', { nodeId: n.id, locale: l })
  }
  const aiImage = p.assets.some((a) => a.kind === 'image' && a.provenance.origin === 'ai_generated')
  const aiAudio = p.assets.some((a) => a.kind === 'audio' && a.provenance.origin === 'ai_generated')
  if (aiImage && p.aiUse.illustration === 'none')
    add('A009', 'error', 'AI-made picture but aiUse.illustration = none')
  if (aiAudio && p.aiUse.narration === 'none')
    add('A009', 'error', 'AI-made narration but aiUse.narration = none')
}

function checkEditorial(p: Pkg, add: Add, rs: PublicRuleSet): void {
  const L = rs.limits
  const n = p.nodes.length
  if (n > L.nodes.max)
    add('E001', 'error', 'Too many nodes', { measured: `${n}`, limit: `max ${L.nodes.max}` })
  else if (n < L.nodes.default.min || n > L.nodes.default.max)
    add('E001', 'info', 'Node count outside the default', {
      measured: `${n}`,
      limit: `default ${L.nodes.default.min}-${L.nodes.default.max}`,
    })

  const forks = p.nodes.filter((x) => x.type === 'fork')
  const endings = p.nodes.filter((x) => x.type === 'ending')
  if (forks.length < L.forksMin)
    add('E002', 'error', 'No fork', { measured: `${forks.length}`, limit: `min ${L.forksMin}` })
  if (endings.length < L.endingsMin)
    add('E003', 'error', 'Too few endings', {
      measured: `${endings.length}`,
      limit: `min ${L.endingsMin}`,
    })

  const ps = p.progressSteps.length
  if (ps > L.progressSteps.max)
    add('E007', 'error', 'Too many progressSteps', {
      measured: `${ps}`,
      limit: `max ${L.progressSteps.max}`,
    })
  else if (ps !== L.progressSteps.default)
    add('E007', 'info', 'progressSteps count outside the default', {
      measured: `${ps}`,
      limit: `default ${L.progressSteps.default}`,
    })
  const byId = new Map(p.nodes.map((x) => [x.id, x]))
  for (const s of p.progressSteps)
    if (byId.get(s)?.isAlternate)
      add('E007', 'warn', 'progressSteps entry is an alternate node, not on the primary path', {
        nodeId: s,
      })

  for (const x of p.nodes) {
    if (x.type === 'fork' && x.choices.length !== 2)
      add('E009', 'error', 'A fork must have exactly 2 choices', {
        nodeId: x.id,
        measured: `${x.choices.length}`,
      })
    if ((x.type === 'fork' || x.type === 'alternate') && x.choices.length === 2) {
      const [a, b] = x.choices
      if (a && b && a.next === b.next) {
        if (x.type === 'fork')
          add('E010', 'error', 'Both fork choices lead to the same node', { nodeId: x.id })
        else add('E010', 'info', 'Both alternate choices lead to the same node', { nodeId: x.id })
      }
    }
    if (x.type === 'ending' && !x.lessonIcon)
      add('E013', 'error', 'Ending has no lessonIcon', { nodeId: x.id })
  }

  for (const l of p.locales) {
    const t = p.text[l]
    if (!t) continue
    const marks = getLocaleDef(l).questionMarks
    const lessons = new Map<string, string>()
    for (const x of p.nodes) {
      const nt = t.nodes[x.id]
      if (!nt) continue
      const where = { nodeId: x.id, locale: l }
      const words = wordCount(nt.text)
      if (L.wordsPerNode.locales.includes(l)) {
        if (words > L.wordsPerNode.max)
          add('E004', 'error', 'Node text is too long', {
            ...where,
            measured: `${words} words`,
            limit: `max ${L.wordsPerNode.max}`,
          })
        else if (words < L.wordsPerNode.default.min || words > L.wordsPerNode.default.max)
          add('E004', 'info', 'Node text length outside the default', {
            ...where,
            measured: `${words} words`,
            limit: `default ${L.wordsPerNode.default.min}-${L.wordsPerNode.default.max}`,
          })
      } else if (words > L.wordsPerNode.max) {
        add('E004', 'info', 'Node text over the English maximum (not enforced for this language)', {
          ...where,
          measured: `${words} words`,
        })
      }
      if (nt.question) {
        const problem = questionProblem(nt.question, marks)
        if (problem) add('E005', 'error', problem, where)
      }
      if (x.type !== 'ending') {
        for (const [cid, ct] of Object.entries(nt.choices ?? {})) {
          const w = wordCount(ct)
          if (
            x.type === 'single' &&
            (w < L.singleChoiceWords.default.min || w > L.singleChoiceWords.default.max)
          )
            add('E006', 'info', `Choice ${cid} length outside the default`, {
              ...where,
              measured: `${w} words`,
              limit: `default ${L.singleChoiceWords.default.min}-${L.singleChoiceWords.default.max}`,
            })
          if (x.type === 'fork' && w >= L.forkChoiceWordsBelow)
            add('E006', 'info', `Fork choice ${cid} is long`, {
              ...where,
              measured: `${w} words`,
              limit: `default under ${L.forkChoiceWordsBelow}`,
            })
        }
      } else {
        const marker = rs.teachingMarkers[l]
        if (marker) {
          const problem = teachingProblem(nt.text, marker)
          if (problem) add('E014', 'error', problem, where)
        }
        if (nt.lesson) {
          const prevNode = lessons.get(nt.lesson)
          if (prevNode) add('E015', 'error', `Same lesson as ending "${prevNode}"`, where)
          else lessons.set(nt.lesson, x.id)
        }
      }
    }
  }

  for (const l of rs.requiredLocales)
    if (!p.locales.includes(l))
      add('E021', 'error', `Required language "${l}" is missing`, { locale: l })
}

function checkWordLists(
  p: Pkg,
  add: Add,
  opts: ValidateOptions,
  skipped: { checkId: string; reason: string }[],
): void {
  const pd = opts.privateData
  if (!pd || pd.ref !== opts.ruleSet.ref) {
    for (const checkId of ['E016', 'E017', 'E018'])
      skipped.push({ checkId, reason: 'private word lists not loaded' })
    return
  }
  for (const l of p.locales) {
    const t = p.text[l]
    if (!t) continue
    for (const [nodeId, nt] of Object.entries(t.nodes)) {
      const strings = [nt.text, nt.question ?? '', ...Object.values(nt.choices ?? {})]
      const where = { nodeId, locale: l }
      for (const s of strings) {
        for (const idiom of pd.idioms)
          if (containsWord(s, idiom))
            add('E016', 'warn', `Possible Western idiom "${idiom}"`, where)
        for (const kw of pd.anachronismKeywords)
          if (containsWord(s, kw)) add('E018', 'warn', `Possible anachronism "${kw}"`, where)
        for (const [term, never] of Object.entries(pd.sanskritNeverCall))
          for (const w of never)
            if (containsWord(s, w)) add('E017', 'warn', `"${w}" may translate ${term}`, where)
      }
    }
  }
}
