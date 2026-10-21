// Legacy waivers (spec §5.4, REQ:64): for origin = "migration" only. A waiver matches on
// (storyId, checkId, nodeId, locale, nodeTextSha256); if the node changes, the waiver lapses.
import { z } from 'zod'
import { jcsSha256 } from '../hashing'
import { Locale, NodeId, Sha256, StoryId } from '../package/v1'
import type { StoryPackageV1 } from '../package/v1'
import type { Finding, ValidationReport } from './types'

export const WaiverFile = z.strictObject({
  storyId: StoryId,
  ruleSetRef: z.string(),
  basis: z.string(),
  measuredOnPackageSha256: Sha256.optional(), // informational only
  waivers: z.array(
    z.strictObject({
      checkId: z.string(),
      ruleId: z.string().nullable(),
      nodeId: NodeId.nullable(),
      locale: Locale.nullable(),
      severity: z.literal('error'),
      measured: z.string().optional(),
      limit: z.string().optional(),
      nodeTextSha256: Sha256,
    }),
  ),
  notes: z.array(z.string()),
  recordedOn: z.iso.date(),
  recordedBy: z.string(),
})
export type WaiverFile = z.infer<typeof WaiverFile>

/**
 * Fingerprint the waiver binds to. Text checks: the node's text entry in that locale.
 * Locale-free checks: the node's structure {id, type, isAlternate, choices} only (no image, scene or
 * lessonIcon), so media binding in phase 2 never invalidates a waiver. Story-level: the graph.
 */
export async function findingFingerprint(
  pkg: StoryPackageV1,
  f: Pick<Finding, 'nodeId' | 'locale'>,
): Promise<string> {
  if (f.nodeId === null) {
    return jcsSha256({
      startNodeId: pkg.startNodeId,
      progressSteps: pkg.progressSteps,
      nodes: pkg.nodes.map(structural),
    })
  }
  if (f.locale !== null) return jcsSha256(pkg.text[f.locale]?.nodes[f.nodeId] ?? null)
  const node = pkg.nodes.find((n) => n.id === f.nodeId)
  return jcsSha256(node ? structural(node) : null)
}

function structural(n: StoryPackageV1['nodes'][number]) {
  return {
    id: n.id,
    type: n.type,
    isAlternate: n.isAlternate,
    choices: n.type === 'ending' ? [] : n.choices,
  }
}

const keyOf = (checkId: string, nodeId: string | null, locale: string | null, sha: string) =>
  `${checkId}|${nodeId ?? '-'}|${locale ?? '-'}|${sha}`

/** Marks matching error findings as waived; recomputes ok. Waivers never apply to non-migration packages. */
export async function applyWaivers(
  report: ValidationReport,
  pkg: StoryPackageV1,
  file: WaiverFile | null,
): Promise<ValidationReport> {
  if (
    !file ||
    pkg.origin !== 'migration' ||
    file.storyId !== pkg.storyId ||
    file.ruleSetRef !== report.ruleSetRef
  ) {
    return report
  }
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

/** Drafts one waiver per unwaived error finding (for the owner to review; never auto-approved). */
export async function draftWaivers(
  report: ValidationReport,
  pkg: StoryPackageV1,
  meta: { basis: string; recordedOn: string; packageSha256?: string },
): Promise<WaiverFile> {
  const waivers = []
  for (const f of report.findings) {
    if (f.severity !== 'error' || f.waived) continue
    waivers.push({
      checkId: f.checkId,
      ruleId: f.ruleId,
      nodeId: f.nodeId,
      locale: f.locale,
      severity: 'error' as const,
      ...(f.measured !== undefined ? { measured: f.measured } : {}),
      ...(f.limit !== undefined ? { limit: f.limit } : {}),
      nodeTextSha256: await findingFingerprint(pkg, f),
    })
  }
  return WaiverFile.parse({
    storyId: pkg.storyId,
    ruleSetRef: report.ruleSetRef,
    basis: meta.basis,
    ...(meta.packageSha256 ? { measuredOnPackageSha256: meta.packageSha256 } : {}),
    waivers,
    notes: [],
    recordedOn: meta.recordedOn,
    recordedBy: 'owner (draft, not yet approved)',
  })
}
