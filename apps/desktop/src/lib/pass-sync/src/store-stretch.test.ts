import 'fake-indexeddb/auto'
import { stretch } from '@orden/pass/crypto'
import { describe, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({ asked: [] as string[] }))
vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  isNative: true,
  isDesktop: true,
  invoke: (command: string) => {
    native.asked.push(command)
    return Promise.resolve(btoa(String.fromCharCode(...new Uint8Array(32).fill(7))))
  },
}))
await import('./store.svelte')
describe('the Pass store in the app', () => {
  test('stretches a password with the app, not in the page', async () => {
    const key = await stretch('Café horse', new Uint8Array(16).fill(3), { m: 64, t: 2, p: 1 })
    expect(native.asked).toContain('pass_stretch')
    expect([...key]).toEqual(new Array(32).fill(7))
  })
})
