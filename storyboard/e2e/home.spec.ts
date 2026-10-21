import { expect, test } from '@playwright/test'

test('home page renders the placeholder', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Storyboard' })).toBeVisible()
})

test('home page sets no cookies', async ({ page, context }) => {
  await page.goto('/')
  expect(await context.cookies()).toEqual([])
})
