// Legacy waivers (spec §5.4). P1-2b (design p1-step8-design.md §5.4, §10.1): the public waiver keys
// (deriveWaiverKeys, applyWaiverKeys), the one matcher behind applyWaivers, and the never-waivable
// integrity checks X000, S001 and A001.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import fixture from '../../../fixtures/packages/two-paths.json'
import { WaiverKeys, type WaiverKey } from '../package/catalogue'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import { StoryPackageV1 } from '../package/v1'
import {
  NEVER_WAIVABLE,
  WaiverFile,
  applyWaiverKeys,
  applyWaivers,
  deriveWaiverKeys,
  draftWaivers,
  findingFingerprint,
  validatePackage,
} from './index'
import type { Finding, ValidationReport } from './index'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const opts = { ruleSet: PANCHATANTRA_RULESET }
const meta = { basis: 'test', recordedOn: '2026-10-21' }
const FILE_SHA = 'f'.repeat(64)

function broken(): Json {
  const p = structuredClone(fixture) as Json
  p.nodes.find((n: Json) => n.id === 'start').choices[1].next = 'wise_path' // E010 (locale-free)
  p.text.en.nodes.ending_wise.text = 'Home.' // E014 (en text)
  // quick_path is now unreachable; drop it and its ending so only the two target findings remain
  p.nodes = p.nodes.filter((n: Json) => !['quick_path', 'ending_quick'].includes(n.id))
  for (const l of ['en', 'hi']) {
    delete p.text[l].nodes.quick_path
    delete p.text[l].nodes.ending_quick
  }
  return p
}

async function waivedReport(p: Json) {
  const pkg = StoryPackageV1.parse(p)
  const report = validatePackage(pkg, opts)
  const file = await draftWaivers(report, pkg, meta)
  return { pkg, report, file }
}

describe('legacy waivers', () => {
  it('drafts one waiver per error finding and clears them when applied', async () => {
    const { pkg, report, file } = await waivedReport(broken())
    const errors = report.findings.filter((f) => f.severity === 'error')
    // start stays a fork (both choices -> wise_path), so E002 does not fire; one ending -> E003.
    expect(errors.map((f) => f.checkId).sort()).toEqual(['E003', 'E010', 'E014'])
    expect(file.waivers).toHaveLength(errors.length)
    const after = await applyWaivers(report, pkg, file)
    expect(after.ok).toBe(true)
    expect(after.findings.filter((f) => f.severity === 'error').every((f) => f.waived)).toBe(true)
  })

  it('lapses when the waived node text changes', async () => {
    const { pkg, file } = await waivedReport(broken())
    const edited = structuredClone(pkg) as Json
    edited.text.en.nodes.ending_wise.text = 'Home again.'
    const editedPkg = StoryPackageV1.parse(edited)
    const after = await applyWaivers(validatePackage(editedPkg, opts), editedPkg, file)
    const e014 = after.findings.find((f) => f.checkId === 'E014')!
    expect(e014.waived).toBeUndefined()
    expect(after.ok).toBe(false)
  })

  it('an E010 waiver survives phase-2 media binding (image added)', async () => {
    const { pkg, file } = await waivedReport(broken())
    const bound = structuredClone(pkg) as Json
    bound.nodes.find((n: Json) => n.id === 'start').image = 'b'.repeat(64)
    bound.nodes.find((n: Json) => n.id === 'start').scene = 'river'
    const boundPkg = StoryPackageV1.parse(bound)
    const after = await applyWaivers(validatePackage(boundPkg, opts), boundPkg, file)
    expect(after.findings.find((f) => f.checkId === 'E010')!.waived).toBe(true)
  })

  it('never applies to packages that are not migrations', async () => {
    const { pkg, file } = await waivedReport(broken())
    const writer = StoryPackageV1.parse({ ...structuredClone(pkg), origin: 'writer_flow' })
    const after = await applyWaivers(validatePackage(writer, opts), writer, file)
    expect(after.ok).toBe(false)
    expect(after.findings.some((f) => f.waived)).toBe(false)
  })
})

/** Two more error findings (E005 on start en, T003 on wise_path hi) for richer subsets. */
function brokenMore(): Json {
  const p = broken()
  p.text.en.nodes.start.question = 'Which way? Left or right?'
  p.text.hi.nodes.wise_path.text = ` ${p.text.hi.nodes.wise_path.text}`
  return p
}

/** The pre-P1-2b applyWaivers matcher (waivers.ts:80-94 before P1-2b), kept here as an oracle. */
async function legacyMatcher(
  report: ValidationReport,
  pkg: StoryPackageV1,
  file: WaiverFile,
): Promise<ValidationReport> {
  const keyOf = (c: string, n: string | null, l: string | null, s: string) =>
    `${c}|${n ?? '-'}|${l ?? '-'}|${s}`
  const allowed = new Set(
    file.waivers.map((w) => keyOf(w.checkId, w.nodeId, w.locale, w.nodeTextSha256)),
  )
  const findings: Finding[] = []
  for (const f of report.findings) {
    if (f.severity !== 'error') {
      findings.push(f)
      continue
    }
    const sha = await findingFingerprint(pkg, f)
    findings.push(
      allowed.has(keyOf(f.checkId, f.nodeId, f.locale, sha)) ? { ...f, waived: true } : f,
    )
  }
  return { ...report, findings, ok: !findings.some((f) => f.severity === 'error' && !f.waived) }
}

const integrityFinding = (checkId: string, nodeId: string | null = null): Finding => ({
  checkId,
  ruleId: null,
  severity: 'error',
  nodeId,
  locale: null,
  message: `${checkId} test finding`,
})

const integrityRecord = (checkId: string): WaiverFile['waivers'][number] => ({
  checkId,
  ruleId: null,
  nodeId: null,
  locale: null,
  severity: 'error',
  nodeTextSha256: 'e'.repeat(64),
})

describe('deriveWaiverKeys (design §5.4)', () => {
  it('keeps only the allowlisted fields, sorted, in the §5.2 shape', async () => {
    const { file } = await waivedReport(brokenMore())
    const block = deriveWaiverKeys(file, FILE_SHA)
    expect(Object.keys(block).sort()).toEqual(['keys', 'ruleSetRef', 'waiverFileSha256'])
    expect(block.ruleSetRef).toBe('panchatantra@3.0.0')
    expect(block.waiverFileSha256).toBe(FILE_SHA)
    for (const k of block.keys) {
      expect(Object.keys(k).sort()).toEqual(['checkId', 'locale', 'nodeId', 'nodeTextSha256'])
    }
    expect(block.keys.map((k) => `${k.checkId}/${k.nodeId}/${k.locale}`)).toEqual([
      'E003/null/null',
      'E005/start/en',
      'E010/start/null',
      'E014/ending_wise/en',
      'T003/wise_path/hi',
    ])
    expect(WaiverKeys.parse(block)).toEqual(block)
  })

  it('is deterministic: record order and the private fields never change the output', async () => {
    const { file } = await waivedReport(brokenMore())
    const block = deriveWaiverKeys(file, FILE_SHA)
    const reversed = { ...file, waivers: [...file.waivers].reverse() }
    expect(JSON.stringify(deriveWaiverKeys(reversed, FILE_SHA))).toBe(JSON.stringify(block))
    const enriched = WaiverFile.parse({
      ...file,
      basis: 'PRIVATE basis',
      notes: ['PRIVATE note'],
      measuredOnPackageSha256: 'e'.repeat(64),
      recordedOn: '2026-11-15',
      recordedBy: 'PRIVATE recorder',
      waivers: file.waivers.map((w) => ({
        ...w,
        ruleId: 'PRIVATE-rule',
        measured: 'PRIVATE measured',
        limit: 'PRIVATE limit',
      })),
    })
    const json = JSON.stringify(deriveWaiverKeys(enriched, FILE_SHA))
    expect(json).toBe(JSON.stringify(block))
    expect(json).not.toMatch(/PRIVATE|basis|notes|ruleId|measured|limit|recorded/)
  })

  it('throws on a duplicate key, whatever the other fields say', async () => {
    const { file } = await waivedReport(broken())
    const first = file.waivers[0]!
    const dup = { ...file, waivers: [...file.waivers, { ...first, ruleId: 'other', limit: 'x' }] }
    expect(() => deriveWaiverKeys(dup, FILE_SHA)).toThrow(
      `waiver file for two-paths has a duplicate key: ${first.checkId} node=${first.nodeId ?? '-'} locale=${first.locale ?? '-'}`,
    )
  })

  it('names exactly X000, S001 and A001 as never waivable', () => {
    expect([...NEVER_WAIVABLE].sort()).toEqual(['A001', 'S001', 'X000'])
  })

  it.each(['X000', 'S001', 'A001'])('throws on a record for %s', async (checkId) => {
    const { file } = await waivedReport(broken())
    const withIntegrity = { ...file, waivers: [...file.waivers, integrityRecord(checkId)] }
    expect(() => deriveWaiverKeys(withIntegrity, FILE_SHA)).toThrow(
      `waiver file for two-paths has a record for ${checkId}, which is never waivable (X000, S001, A001)`,
    )
  })
})

describe('applyWaiverKeys (design §5.4)', () => {
  it('waives through keys exactly as the drafted file does; nothing unused, nothing lapsed', async () => {
    const { pkg, report, file } = await waivedReport(broken())
    const applied = await applyWaiverKeys(report, pkg, deriveWaiverKeys(file, FILE_SHA).keys)
    expect(applied.report.ok).toBe(true)
    expect(
      applied.report.findings.filter((f) => f.severity === 'error').every((f) => f.waived),
    ).toBe(true)
    expect(applied.unused).toEqual([])
    expect(applied.lapsed).toEqual([])
    expect(applied.report).toEqual(await applyWaivers(report, pkg, file))
  })

  it('lapses through keys when the waived node text changes, and names the finding', async () => {
    const { pkg, file } = await waivedReport(broken())
    const keys = deriveWaiverKeys(file, FILE_SHA).keys
    const edited = structuredClone(pkg) as Json
    edited.text.en.nodes.ending_wise.text = 'Home again.'
    const editedPkg = StoryPackageV1.parse(edited)
    const applied = await applyWaiverKeys(validatePackage(editedPkg, opts), editedPkg, keys)
    const e014 = applied.report.findings.find((f) => f.checkId === 'E014')!
    expect(e014.waived).toBeUndefined()
    expect(applied.report.ok).toBe(false)
    expect(applied.lapsed).toEqual([e014])
    expect(applied.lapsed[0]).toBe(e014) // the same object as in the report
    expect(applied.unused.map((k) => k.checkId)).toEqual(['E014'])
    expect(applied.report.findings.find((f) => f.checkId === 'E010')!.waived).toBe(true)
  })

  it('keeps an E010 key through phase-2 media binding (picture and its asset added)', async () => {
    const { pkg, file } = await waivedReport(broken())
    const keys = deriveWaiverKeys(file, FILE_SHA).keys
    const bound = structuredClone(pkg) as Json
    const start = bound.nodes.find((n: Json) => n.id === 'start')
    start.image = 'b'.repeat(64)
    start.scene = 'river'
    bound.assets = [
      {
        kind: 'image',
        id: 'b'.repeat(64),
        width: 800,
        height: 600,
        variants: [
          { path: `media/two-paths/${'b'.repeat(64)}-w800.webp`, mime: 'image/webp', bytes: 9 },
        ],
        provenance: { origin: 'human' },
      },
    ]
    const boundPkg = StoryPackageV1.parse(bound)
    const applied = await applyWaiverKeys(validatePackage(boundPkg, opts), boundPkg, keys)
    expect(applied.report.findings.find((f) => f.checkId === 'E010')!.waived).toBe(true)
    expect(applied.report.findings.some((f) => f.checkId === 'A001')).toBe(false)
    expect(applied.report.ok).toBe(true)
  })

  it('reports a key unused when its finding is gone (text fixed) or is not an error', async () => {
    const { pkg, file } = await waivedReport(broken())
    const keys = deriveWaiverKeys(file, FILE_SHA).keys
    const fixed = structuredClone(pkg) as Json
    fixed.text.en.nodes.ending_wise.text = (fixture as Json).text.en.nodes.ending_wise.text
    const fixedPkg = StoryPackageV1.parse(fixed)
    const report = validatePackage(fixedPkg, opts)
    expect(report.findings.some((f) => f.checkId === 'E014')).toBe(false)
    const a006 = report.findings.find((f) => f.checkId === 'A006')!
    const warnKey: WaiverKey = {
      checkId: 'A006',
      nodeId: a006.nodeId,
      locale: a006.locale,
      nodeTextSha256: await findingFingerprint(fixedPkg, a006),
    }
    const applied = await applyWaiverKeys(report, fixedPkg, [...keys, warnKey])
    expect(applied.unused.map((k) => k.checkId)).toEqual(['E014', 'A006'])
    expect(applied.lapsed).toEqual([])
    expect(applied.report.ok).toBe(true)
    expect(applied.report.findings).toContain(a006) // passed through, not marked waived
    expect(a006.waived).toBeUndefined()
  })

  it.each(['X000', 'S001', 'A001'])(
    'a matching key never waives %s: it stays an unwaived error and the key is unused',
    async (checkId) => {
      const { pkg, report, file } = await waivedReport(broken())
      const injected = integrityFinding(checkId, checkId === 'A001' ? 'start' : null)
      const withIntegrity: ValidationReport = {
        ...report,
        findings: [...report.findings, injected],
      }
      const forged: WaiverKey = {
        checkId,
        nodeId: injected.nodeId,
        locale: null,
        nodeTextSha256: await findingFingerprint(pkg, injected),
      }
      const keys = [...deriveWaiverKeys(file, FILE_SHA).keys, forged]
      const applied = await applyWaiverKeys(withIntegrity, pkg, keys)
      const after = applied.report.findings.find((f) => f.checkId === checkId)!
      expect(after.severity).toBe('error')
      expect(after.waived).toBeUndefined()
      expect(applied.report.ok).toBe(false)
      expect(applied.unused).toEqual([forged])
      expect(applied.lapsed).toEqual([])
      // The other keys still work (the test is not vacuous).
      const others = applied.report.findings.filter(
        (f) => f.severity === 'error' && f.checkId !== checkId,
      )
      expect(others.map((f) => f.checkId).sort()).toEqual(['E003', 'E010', 'E014'])
      expect(others.every((f) => f.waived)).toBe(true)
    },
  )

  it('waives a real A001 finding never, even with its exact key', async () => {
    const p = structuredClone(fixture) as Json
    p.origin = 'migration'
    p.nodes[0].image = '9'.repeat(64)
    const pkg = StoryPackageV1.parse(p)
    const report = validatePackage(pkg, opts)
    const a001 = report.findings.find((f) => f.checkId === 'A001')!
    const key: WaiverKey = {
      checkId: 'A001',
      nodeId: a001.nodeId,
      locale: a001.locale,
      nodeTextSha256: await findingFingerprint(pkg, a001),
    }
    const applied = await applyWaiverKeys(report, pkg, [key])
    expect(applied.report.findings.find((f) => f.checkId === 'A001')!.waived).toBeUndefined()
    expect(applied.report.ok).toBe(false)
    expect(applied.unused).toEqual([key])
  })

  it.each(['X000', 'S001', 'A001'])(
    'leaves a %s finding that arrives marked waived unwaived (no path waives it)',
    async (checkId) => {
      const { pkg, report, file } = await waivedReport(broken())
      const preWaived: Finding = { ...integrityFinding(checkId, 'start'), waived: true }
      const input: ValidationReport = { ...report, findings: [...report.findings, preWaived] }
      const applied = await applyWaiverKeys(input, pkg, deriveWaiverKeys(file, FILE_SHA).keys)
      const after = applied.report.findings.find((f) => f.checkId === checkId)!
      expect(after.waived).toBe(false)
      expect(applied.report.ok).toBe(false)
      expect(applied.lapsed).toEqual([])
      // Only the integrity finding stays unwaived: the other keys still waive theirs.
      expect(
        applied.report.findings
          .filter((f) => f.severity === 'error' && !f.waived)
          .map((f) => f.checkId),
      ).toEqual([checkId])
      expect(await applyWaivers(input, pkg, file)).toEqual(applied.report)
    },
  )

  it('applyWaiverKeys(derive(file)) waives exactly what applyWaivers(file) and the pre-P1-2b matcher do, over random subsets', async () => {
    const { pkg, report, file } = await waivedReport(brokenMore())
    expect(file.waivers).toHaveLength(5)
    const edited = structuredClone(pkg) as Json
    edited.text.en.nodes.ending_wise.text = 'Home again.'
    edited.text.en.nodes.start.question = 'Which way? Left or right? Now?'
    const editedPkg = StoryPackageV1.parse(edited)
    const editedReport = validatePackage(editedPkg, opts)
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(file.waivers), fc.boolean(), async (records, edit) => {
        const subset: WaiverFile = { ...file, waivers: records }
        const target = edit ? editedPkg : pkg
        const base = edit ? editedReport : report
        const viaKeys = await applyWaiverKeys(base, target, deriveWaiverKeys(subset, FILE_SHA).keys)
        expect(viaKeys.report).toEqual(await applyWaivers(base, target, subset))
        expect(viaKeys.report).toEqual(await legacyMatcher(base, target, subset))
        const waived = viaKeys.report.findings.filter((f) => f.waived).length
        expect(waived + viaKeys.unused.length).toBe(records.length)
      }),
      { seed: 20261114, numRuns: 100 },
    )
  })
})

describe('applyWaivers on top of the keys (design §9 item 39)', () => {
  it('stays silent for another story, another rule set or no file', async () => {
    const { pkg, report, file } = await waivedReport(broken())
    expect(await applyWaivers(report, pkg, null)).toBe(report)
    expect(await applyWaivers(report, pkg, { ...file, storyId: 'blue-jackal' })).toBe(report)
    expect(await applyWaivers(report, pkg, { ...file, ruleSetRef: 'panchatantra@3.1.0' })).toBe(
      report,
    )
  })

  it.each(['X000', 'S001', 'A001'])('throws on a file with a %s record', async (checkId) => {
    const { pkg, report, file } = await waivedReport(broken())
    const bad = { ...file, waivers: [...file.waivers, integrityRecord(checkId)] }
    await expect(applyWaivers(report, pkg, bad)).rejects.toThrow(/never waivable/)
  })

  it('throws on a file with a duplicate record', async () => {
    const { pkg, report, file } = await waivedReport(broken())
    const bad = { ...file, waivers: [...file.waivers, file.waivers[0]!] }
    await expect(applyWaivers(report, pkg, bad)).rejects.toThrow(/duplicate key/)
  })
})

describe('draftWaivers (design §9 item 39)', () => {
  it('drafts no record for X000, S001 or A001, so a draft never trips the refusal', async () => {
    const { pkg, report } = await waivedReport(broken())
    const withIntegrity: ValidationReport = {
      ...report,
      findings: [
        ...report.findings,
        integrityFinding('X000'),
        integrityFinding('S001'),
        integrityFinding('A001', 'start'),
      ],
    }
    const draft = await draftWaivers(withIntegrity, pkg, meta)
    expect(draft.waivers.map((w) => w.checkId).sort()).toEqual(['E003', 'E010', 'E014'])
    const after = await applyWaivers(withIntegrity, pkg, draft)
    expect(
      after.findings.filter((f) => f.severity === 'error' && !f.waived).map((f) => f.checkId),
    ).toEqual(['X000', 'S001', 'A001'])
    expect(after.ok).toBe(false)
  })

  it('drafts one record for findings that share a key, so the draft applies and waives both', async () => {
    const p = structuredClone(fixture) as Json
    p.text.en.nodes.start.text = ` ${p.text.en.nodes.start.text}`
    p.text.en.nodes.start.question = ` ${p.text.en.nodes.start.question}`
    const pkg = StoryPackageV1.parse(p)
    const report = validatePackage(pkg, opts)
    const errors = report.findings.filter((f) => f.severity === 'error')
    // One check on two strings of one node and locale: the same key twice.
    expect(errors.map((f) => `${f.checkId}/${f.nodeId}/${f.locale}`)).toEqual([
      'T003/start/en',
      'T003/start/en',
    ])
    const draft = await draftWaivers(report, pkg, meta)
    expect(draft.waivers).toHaveLength(1)
    expect(deriveWaiverKeys(draft, FILE_SHA).keys).toHaveLength(1)
    const after = await applyWaivers(report, pkg, draft)
    expect(after.findings.filter((f) => f.checkId === 'T003').map((f) => f.waived)).toEqual([
      true,
      true,
    ])
    expect(after.ok).toBe(true)
  })
})
