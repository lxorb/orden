import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
}))

const { shells } = await import('./shells.svelte')

function anotherWindowWrote(key: string, value: string) {
  localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

afterEach(() => {
  localStorage.clear()
  shells.heard()
})

describe('terminal settings changed in another window', () => {
  test('stop keeping terminal history here too', () => {
    expect(shells.restoring).toBe(true)
    anotherWindowWrote('orden:terminal-restore', 'no')
    expect(shells.restoring).toBe(false)
  })

  test('keep the other window key choices when this one changes its own', () => {
    anotherWindowWrote('orden:terminal-keys', JSON.stringify({ 'ctrl+k': 'shell' }))
    shells.setWay('ctrl+l', 'app')
    expect(JSON.parse(localStorage.getItem('orden:terminal-keys') ?? '{}')).toEqual({
      'ctrl+k': 'shell',
      'ctrl+l': 'app',
    })
  })
})
