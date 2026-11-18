import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'vitest'
import { pass } from './store.svelte'

afterEach(() => localStorage.clear())

describe('password settings changed in another window', () => {
  test('are kept when this window changes another one', () => {
    localStorage.setItem('orden:pass-settings', JSON.stringify({ relockAfter: 1 }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'orden:pass-settings' }))
    expect(pass.settings.relockAfter).toBe(1)

    pass.setSetting('clipboardClear', 15)
    expect(JSON.parse(localStorage.getItem('orden:pass-settings') ?? '{}')).toMatchObject({
      relockAfter: 1,
      clipboardClear: 15,
    })
  })

  test('leave the lock to what this window holds of the device', () => {
    const lock = pass.settings.lock
    localStorage.setItem('orden:pass-settings', JSON.stringify({ lock: 'pin', relockAfter: 2 }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'orden:pass-settings' }))
    expect(pass.settings.relockAfter).toBe(2)
    expect(pass.settings.lock).toBe(lock)
  })
})
