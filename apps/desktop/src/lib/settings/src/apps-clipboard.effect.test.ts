import { afterEach, describe, expect, test } from 'vitest'
import { clipboardSharing } from './apps-clipboard.svelte'

afterEach(() => {
  localStorage.clear()
  clipboardSharing.set(true)
})
describe('sharing the clipboard with apps', () => {
  test('stops in this window when another window turns it off', () => {
    expect(clipboardSharing.on).toBe(true)
    localStorage.setItem('orden:apps-clipboard', 'no')
    window.dispatchEvent(new StorageEvent('storage', { key: 'orden:apps-clipboard' }))
    expect(clipboardSharing.on).toBe(false)
  })
})
