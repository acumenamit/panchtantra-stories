// Owner screenshots of the Lantern Night look (spec §6.1 OD-9; P1-1b, design §3.6 #32 and §8 E2E
// 6). Local only: skipped unless SPECIMEN=1. For each project, at 100%, 125% and 150% text, at the
// project's viewport and at 320 px wide, it saves / and / with the injected specimen (swatches,
// an English and a Hindi fixture passage with a question and two choices, a focused primary
// button) to storyboard/migration-input/step6-look/ (git-ignored). No baselines are compared.
import path from 'node:path'
import { TEXT_SCALES } from '../src/core/progress/records'
import { expect, test } from './fixtures'
import { focusByKeyboard, injectSpecimen, prefsText, seedPrefs, settleFonts } from './page-helpers'

const OUTPUT_DIR = path.resolve(__dirname, '../migration-input/step6-look')

test.skip(process.env['SPECIMEN'] !== '1', 'owner screenshots: run with SPECIMEN=1')

for (const scale of TEXT_SCALES) {
  test(`screenshots at ${scale}%`, async ({ page, browserName }, testInfo) => {
    const project = testInfo.project.name
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the project sets no viewport')
    await seedPrefs(page, prefsText(scale))
    for (const width of [viewport.width, 320]) {
      await page.setViewportSize({ width, height: viewport.height })
      const suffix = width === viewport.width ? '' : '-320px'
      await page.goto('/')
      await settleFonts(page)
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${project}-home-${scale}${suffix}.png`),
        fullPage: true,
      })

      await injectSpecimen(page)
      await settleFonts(page)
      await focusByKeyboard(page, browserName, '#specimen-action-en')
      await expect(page.locator('#specimen-action-en')).toBeFocused()
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${project}-specimen-${scale}${suffix}.png`),
        fullPage: true,
      })
    }
  })
}
