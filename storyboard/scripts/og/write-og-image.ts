// Writes the site's fallback og:image, public/og/storyboard-1200x630.jpg (design
// p1-step12-design.md §3.19 N19, §4.10; P1-3 Step 12b), from scripts/og/og-image.ts:
//   corepack pnpm exec tsx scripts/og/write-og-image.ts   (from storyboard/; no package.json script)
// The file is committed. Run this only when the picture is meant to change, and then give it a new
// file name too: crawlers cache an og:image by its URL (design §1.3 H-17, R22). og-image.test.ts
// fails while the committed bytes differ from what this writes.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { OG_FILE, ogFallbackJpeg } from './og-image'

const bytes = ogFallbackJpeg()
mkdirSync(dirname(OG_FILE), { recursive: true })
writeFileSync(OG_FILE, bytes)
const where = relative(process.cwd(), OG_FILE).replace(/\\/g, '/')
const digest = createHash('sha256').update(bytes).digest('hex')
console.log(`og image: wrote ${where}, ${bytes.length} bytes, sha256 ${digest}`)
