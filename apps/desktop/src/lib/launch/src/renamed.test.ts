import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
await import('./renamed.svelte')
async function launched() {
  vi.resetModules()
  const { renamed } = await import('./renamed.svelte')
  return renamed
}
beforeEach(() => localStorage.clear())
test('is said to an install an earlier version wrote settings into', async () => {
  localStorage.setItem('orden:theme', 'dark')
  expect((await launched()).showing).toBe(true)
})
test('is said once, however many launches follow', async () => {
  localStorage.setItem('orden:session', '{}')
  const first = await launched()
  first.dismiss()
  expect(first.showing).toBe(false)
  expect((await launched()).showing).toBe(false)
})
test('is never said to a fresh install, on this launch or the next', async () => {
  expect((await launched()).showing).toBe(false)
  localStorage.setItem('orden:theme', 'dark')
  expect((await launched()).showing).toBe(false)
})
test('reads nothing but its own app’s settings as an earlier version', async () => {
  localStorage.setItem('somebody-else', 'yes')
  expect((await launched()).showing).toBe(false)
})
