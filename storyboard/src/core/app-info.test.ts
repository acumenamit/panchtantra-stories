import { describe, expect, it } from 'vitest'
import { APP_NAME } from './app-info'

describe('app-info', () => {
  it('names the app', () => {
    expect(APP_NAME).toBe('Storyboard')
  })
})
