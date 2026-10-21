// Story Package v1 (spec §4.2). Field names follow Rules v3 §4 (OD-14).
// Zod checks shape and format ceilings only; editorial limits live in the rule set (§5, P0-6).
// Two modes: "strict" rejects unknown keys (authoring, publish); "read" strips them (reader).
import { z } from 'zod'
import { LOCALE_CODES } from '../locales'

export type SchemaMode = 'strict' | 'read'

export const StoryId = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
export const NodeId = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
export const ChoiceId = z.string().regex(/^c[1-4]$/) // c1..c4 by position
export const Locale = z.enum(LOCALE_CODES)
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const AiUse = z.enum(['none', 'assisted', 'generated', 'mixed', 'unknown'])

function buildSchemas(mode: SchemaMode) {
  // Strict and stripping objects infer the same output type, so one static type covers both.
  const obj = <T extends z.ZodRawShape>(shape: T) =>
    (mode === 'strict' ? z.strictObject(shape) : z.object(shape)) as unknown as z.ZodObject<T>

  const Choice = obj({ id: ChoiceId, next: NodeId })

  const nodeBase = {
    id: NodeId,
    scene: z.string(),
    isAlternate: z.boolean(),
    image: Sha256.nullable(), // asset id; null = no picture (phase 1)
  }

  // Per-type choice counts are FIXED (OQ-9): single 1, fork 2, alternate 1-2, ending 0.
  const Node = z.discriminatedUnion('type', [
    obj({ ...nodeBase, type: z.literal('single'), choices: z.array(Choice).length(1) }),
    obj({ ...nodeBase, type: z.literal('fork'), choices: z.array(Choice).length(2) }),
    obj({ ...nodeBase, type: z.literal('alternate'), choices: z.array(Choice).min(1).max(2) }),
    obj({ ...nodeBase, type: z.literal('ending'), lessonIcon: z.string().min(1).max(32) }),
  ])

  const NodeText = obj({
    text: z.string().min(1), // an ending's text ends with its teaching line
    question: z.string().min(1).optional(), // non-endings only (validator)
    choices: z.record(ChoiceId, z.string().min(1)).optional(), // non-endings only; leading emoji stays
    lesson: z.string().min(1).optional(), // endings only (validator)
  })

  const LocaleText = obj({
    title: z.string(),
    description: z.string(),
    theme: z.string(),
    duration: z.string(),
    book: z.string(),
    nodes: z.record(NodeId, NodeText),
    alt: z.record(Sha256, z.string()).optional(), // reserved: owner-written alt text later
  })

  const Provenance = obj({
    origin: z.enum(['ai_generated', 'human', 'unknown']),
    vendor: z.string().optional(),
    product: z.string().optional(),
    voice: z.string().optional(),
    tier: z.enum(['paid', 'free', 'unknown']).optional(),
    c2paInMaster: z.boolean().optional(),
  })

  const Variant = obj({
    path: z.string(),
    mime: z.enum(['image/webp', 'image/jpeg', 'audio/mpeg']),
    bytes: z.number().int().positive(),
    width: z.number().int().optional(),
  })

  const Asset = z.discriminatedUnion('kind', [
    obj({
      kind: z.literal('image'),
      id: Sha256,
      width: z.number().int(),
      height: z.number().int(),
      variants: z.array(Variant).min(1),
      provenance: Provenance,
    }),
    obj({
      kind: z.literal('audio'),
      id: Sha256,
      nodeId: NodeId,
      locale: Locale,
      durationMs: z.number().int().positive(),
      variants: z.array(Variant).length(1),
      provenance: Provenance,
      narratedTextSha256: Sha256, // hash of the exact narration input (OD-20)
    }),
  ])

  const StoryPackage = obj({
    schemaVersion: z.literal('1.0'),
    storyId: StoryId,
    version: z.number().int().min(1),
    origin: z.enum(['migration', 'agent_flow', 'writer_flow']),
    collectionId: z.string(),
    source: obj({
      work: z.literal('panchatantra'),
      book: z.enum(['I', 'II', 'III', 'IV', 'V']),
    }),
    age: z.string().regex(/^\d{1,2}\+$/),
    addedOn: z.iso.date(),
    emoji: z.string(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    access: obj({ tier: z.literal('free') }), // monetisation seam
    aiUse: obj({ text: AiUse, illustration: AiUse, narration: AiUse }),
    locales: z.array(Locale).min(1),
    defaultLocale: Locale,
    startNodeId: NodeId,
    progressSteps: z.array(NodeId).min(1).max(32), // format ceiling; the rule set says max 10
    nodes: z.array(Node).min(2).max(64), // format ceiling; the rule set says max 20
    // partialRecord: with an enum key, z.record would require every enum value (incl. disabled "ar").
    text: z.partialRecord(Locale, LocaleText),
    assets: z.array(Asset),
  }).superRefine((p, ctx) => {
    const unique = new Set(p.locales)
    if (unique.size !== p.locales.length) {
      ctx.addIssue({ code: 'custom', path: ['locales'], message: 'locales must be unique' })
    }
    if (!unique.has(p.defaultLocale)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultLocale'],
        message: 'defaultLocale must be one of locales',
      })
    }
    const textKeys = new Set(Object.keys(p.text))
    const sameSet = textKeys.size === unique.size && [...unique].every((l) => textKeys.has(l))
    if (!sameSet) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'text must have exactly one entry per locale in locales',
      })
    }
  })

  return { Choice, Node, NodeText, LocaleText, Provenance, Variant, Asset, StoryPackage }
}

/** True if any plain object in the value has an own "__proto__" key (as JSON.parse can create). */
export function hasOwnProtoKey(value: unknown, depth = 0): boolean {
  if (depth > 64 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => hasOwnProtoKey(v, depth + 1))
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) return true
  return Object.values(value).some((v) => hasOwnProtoKey(v, depth + 1))
}

export const strictSchemas = buildSchemas('strict')
export const readSchemas = buildSchemas('read')

/** Authoring and publish: unknown keys are errors. */
export const StoryPackageV1 = z
  .unknown()
  .superRefine((value, ctx) => {
    // Zod records skip "__proto__" keys silently; the raw bytes would still be hashed and published.
    if (hasOwnProtoKey(value)) {
      ctx.addIssue({ code: 'custom', message: '"__proto__" keys are not allowed in a package' })
    }
  })
  .pipe(strictSchemas.StoryPackage)
/** Reader: unknown keys are stripped, so newer optional fields do not break old readers. */
export const StoryPackageV1Read = readSchemas.StoryPackage

export type StoryPackageV1 = z.infer<typeof StoryPackageV1>
export type StoryNode = z.infer<typeof strictSchemas.Node>
export type StoryChoice = z.infer<typeof strictSchemas.Choice>
export type StoryAsset = z.infer<typeof strictSchemas.Asset>
export type NodeTypeName = StoryNode['type']
