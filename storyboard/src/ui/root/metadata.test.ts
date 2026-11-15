// Root metadata (design p1-step7-design.md §3.12 #17, #20, §4.1, §8.1 item 6; P1-1c): "/" keeps
// exactly the metadata it had before Step 7 (app/layout.tsx), and the title template.
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../../core/app-info'
import { ROOT_METADATA, ROOT_ROBOTS, TITLE_TEMPLATE, readerRootMetadata } from './metadata'

describe('root metadata', () => {
  it('equals the pre-Step 7 app/layout.tsx metadata exactly', () => {
    expect(ROOT_METADATA).toStrictEqual({
      title: 'Storyboard',
      description: 'Interactive stories for children (work in progress).',
      robots: { index: false, follow: false },
    })
  })

  it('is noindex, nofollow, shared by every root layout', () => {
    expect(ROOT_ROBOTS).toStrictEqual({ index: false, follow: false })
    expect(ROOT_METADATA.robots).toBe(ROOT_ROBOTS)
  })

  it('titles sub-pages "%s – Storyboard" with an en dash', () => {
    expect(TITLE_TEMPLATE).toBe('%s – Storyboard')
    expect(TITLE_TEMPLATE.replace('%s', 'For grown-ups')).toBe('For grown-ups – Storyboard')
    expect(ROOT_METADATA.title).toBe(APP_NAME)
  })

  it('gives the [locale] root layout the title default and template, the description and robots', () => {
    expect(readerRootMetadata('Some description.')).toStrictEqual({
      title: { default: 'Storyboard', template: '%s – Storyboard' },
      description: 'Some description.',
      robots: { index: false, follow: false },
    })
    expect(readerRootMetadata('x').robots).toBe(ROOT_ROBOTS)
  })
})
