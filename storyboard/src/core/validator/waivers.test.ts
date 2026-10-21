import { describe, expect, it } from 'vitest'
import fixture from '../../../fixtures/packages/two-paths.json'
import { PANCHATANTRA_RULESET } from '../rules/panchatantra'
import { StoryPackageV1 } from '../package/v1'
import { applyWaivers, draftWaivers, validatePackage } from './index'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const opts = { ruleSet: PANCHATANTRA_RULESET }
const meta = { basis: 'test', recordedOn: '2026-10-21' }

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
