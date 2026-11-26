import { expect, test } from 'vitest'
import { HISTORY, isOwnPage } from './own-pages'

test('the history page is the app’s own', () => {
  expect(isOwnPage(HISTORY)).toBe(true)
  expect(isOwnPage('https://example.com/history')).toBe(false)
  expect(isOwnPage(null)).toBe(false)
})
