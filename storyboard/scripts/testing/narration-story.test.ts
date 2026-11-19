// The staging narrated story's clip table (design p1-step11-design.md §2.2, §3.23 N23, §8.1, §9
// A27, §13.3 T11-20; P1-5a). scripts/testing/narration-story.ts lists the 15 clips (every node of
// the river-stones fixture in en and hi, except big_rock in hi, which exercises a part with no clip,
// N12), their asset ids and Storage paths, and the clip bytes. e2e/narration-media.ts builds the
// clip URLs from it, so it must load in a spec: no import.meta (specs compile as CommonJS) and only
// node:crypto, ./silent-mp3 and ./narration-story-id as imports. NARRATION_STORY_ID is a leaf
// module, as PICTURE_STORY_ID is. The expected values are written out here.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { planMediaHeads } from '../../src/core/content/media'
import { NARRATION_STORY_ID } from './narration-story-id'
import {
  NARRATION_CLIP,
  NARRATION_CLIP_TYPE,
  NARRATION_CLIPS,
  NARRATION_DURATION_MS,
  narratedTextSha256Of,
  narrationAssetId,
  narrationClipPath,
} from './narration-story'
import { silentMp3 } from './silent-mp3'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ID = 'river-stones-narrated'
const NODES = [
  'start',
  'flat_stones',
  'big_rock',
  'far_bank',
  'round_stones',
  'ending_dry',
  'ending_wet',
  'ending_back',
]
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** The source text of a module of this folder, parsed. */
function sourceOf(name: string): ts.SourceFile {
  const path = join(REPO, 'scripts', 'testing', name)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** Every module a file loads: import and export specifiers, require() and import() arguments. */
function loadedModules(file: ts.SourceFile): { modules: string[]; importMeta: number } {
  const modules: string[] = []
  let importMeta = 0
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const named = ts.isIdentifier(callee) && callee.text === 'require'
      if (named || callee.kind === ts.SyntaxKind.ImportKeyword) {
        const [first] = node.arguments
        modules.push(first !== undefined && ts.isStringLiteralLike(first) ? first.text : '?')
      }
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) importMeta++
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { modules, importMeta }
}

describe('NARRATION_STORY_ID, a leaf module (design §2.2)', () => {
  it('is river-stones-narrated, the one statement of a module that imports nothing', () => {
    expect(NARRATION_STORY_ID).toBe(ID)
    const file = sourceOf('narration-story-id.ts')
    expect(file.statements.map((statement) => ts.isVariableStatement(statement))).toEqual([true])
    const [statement] = file.statements
    if (!statement || !ts.isVariableStatement(statement)) throw new Error('not a const')
    expect(statement.getText()).toBe(`export const NARRATION_STORY_ID = '${ID}'`)
  })
})

describe('the narrated story clip table (design §3.23, T11-20)', () => {
  it('precondition: the river-stones fixture has these 8 nodes, in en and hi', () => {
    const fixture = JSON.parse(
      readFileSync(join(REPO, 'fixtures', 'packages', 'river-stones.json'), 'utf8'),
    ) as { nodes: { id: string }[]; locales: string[] }
    expect(fixture.nodes.map((node) => node.id)).toEqual(NODES)
    expect(fixture.locales).toEqual(['en', 'hi'])
  })

  it('(g1) 15 clips: every node in en and hi, except big_rock in hi, in node then locale order', () => {
    const expected = NODES.flatMap((nodeId) =>
      ['en', 'hi']
        .filter((locale) => !(nodeId === 'big_rock' && locale === 'hi'))
        .map((locale) => ({ nodeId, locale })),
    )
    expect(expected).toHaveLength(15)
    expect(NARRATION_CLIPS).toEqual(expected)
  })

  it('(g2) each path is media/river-stones-narrated/<64 hex>-audio.mp3 and passes the media path rule', () => {
    for (const { nodeId, locale } of NARRATION_CLIPS) {
      const assetId = sha256(`${ID}:${nodeId}:${locale}:audio`)
      expect(narrationAssetId(nodeId, locale), `${nodeId} ${locale} asset id`).toBe(assetId)
      expect(narrationClipPath(nodeId, locale), `${nodeId} ${locale} path`).toBe(
        `media/${ID}/${assetId}-audio.mp3`,
      )
      expect(narratedTextSha256Of(nodeId, locale), `${nodeId} ${locale} narratedTextSha256`).toBe(
        sha256(`${ID}:${nodeId}:${locale}`),
      )
    }
    const paths = NARRATION_CLIPS.map(({ nodeId, locale }) => narrationClipPath(nodeId, locale))
    expect(new Set(paths).size).toBe(15)
    const plan = planMediaHeads(
      [
        {
          pkg: {
            storyId: ID,
            assets: NARRATION_CLIPS.map(({ nodeId, locale }) => ({
              kind: 'audio' as const,
              id: narrationAssetId(nodeId, locale),
              nodeId,
              locale,
              durationMs: 1008,
              variants: [
                {
                  path: narrationClipPath(nodeId, locale),
                  mime: 'audio/mpeg' as const,
                  bytes: 6048,
                },
              ],
              provenance: { origin: 'unknown' as const },
              narratedTextSha256: narratedTextSha256Of(nodeId, locale),
            })),
          },
        },
      ],
      '',
    )
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.value.heads.map((head) => [head.path, head.mime, head.bytes])).toEqual(
      paths.map((path) => [path, 'audio/mpeg', 6048]),
    )
    // The path of a clip the table leaves out is still computable (a spec checks it is never asked).
    expect(narrationClipPath('big_rock', 'hi')).toBe(
      `media/${ID}/${sha256(`${ID}:big_rock:hi:audio`)}-audio.mp3`,
    )
  })

  it('the clip is the 42-frame silent MP3: 6,048 bytes, audio/mpeg, 1,008 ms', () => {
    expect(NARRATION_CLIP).toEqual(silentMp3(42))
    expect(NARRATION_CLIP.length).toBe(6048)
    expect(NARRATION_CLIP_TYPE).toBe('audio/mpeg')
    expect(NARRATION_DURATION_MS).toBe(1008)
  })

  it('(g3) loads in a spec: no import.meta; imports only node:crypto, ./silent-mp3, ./narration-story-id', () => {
    const { modules, importMeta } = loadedModules(sourceOf('narration-story.ts'))
    expect(importMeta, 'import.meta reads').toBe(0)
    expect([...modules].sort()).toEqual(['./narration-story-id', './silent-mp3', 'node:crypto'])
    // The id module and the MP3 builder load nothing either.
    expect(loadedModules(sourceOf('narration-story-id.ts'))).toEqual({ modules: [], importMeta: 0 })
    expect(loadedModules(sourceOf('silent-mp3.ts'))).toEqual({ modules: [], importMeta: 0 })
  })

  it('(g3) the reader of loaded modules sees each form (samples)', () => {
    const read = (text: string) =>
      loadedModules(ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true))
    expect(read("import a from 'a'\nexport * from 'b'\nconst c = require('c')")).toEqual({
      modules: ['a', 'b', 'c'],
      importMeta: 0,
    })
    expect(read("const d = await import('d')\nconst u = import.meta.url")).toEqual({
      modules: ['d'],
      importMeta: 1,
    })
  })
})
