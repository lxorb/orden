import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const homes = vi.hoisted(() => ({ left: ['/old/ch.emilvinu.x'] as string[] | null }))
vi.mock('../../platform/src/tauri', async (real) => ({
  ...(await real<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string) =>
    command === 'former_homes' && homes.left
      ? Promise.resolve({ homes: [], left: homes.left })
      : Promise.reject(new Error('no')),
}))
async function launched(left: unknown) {
  vi.resetModules()
  vi.stubGlobal('__ORDEN_FORMER__', left === undefined ? null : { homes: [], left })
  const { formerLeft } = await import('./former-left.svelte')
  return formerLeft
}
beforeEach(() => {
  localStorage.clear()
  homes.left = ['/old/ch.emilvinu.x']
})
test('says nothing when everything moved, or when no older install was there', async () => {
  expect((await launched([])).showing).toBe(false)
  expect((await launched(undefined)).showing).toBe(false)
})
test('says which folders could not be moved whole, on every launch until it is dismissed', async () => {
  const first = await launched(['/old/a', '/old/b'])
  expect(first.showing).toBe(true)
  expect(first.left).toEqual(['/old/a', '/old/b'])
  expect((await launched(['/old/a', '/old/b'])).showing).toBe(true)
  first.dismiss()
  expect(first.showing).toBe(false)
  const next = await launched(['/old/a', '/old/b'])
  expect(next.showing).toBe(false)
  expect(next.left).toEqual(['/old/a', '/old/b'])
})
test('says so again when what is left is no longer what was dismissed', async () => {
  ;(await launched(['/old/a'])).dismiss()
  expect((await launched(['/old/a', '/old/b'])).showing).toBe(true)
})
test('reads what is left again on asking, and keeps what it knew when the app would not say', async () => {
  const one = await launched(['/old/a'])
  await one.look()
  expect(one.left).toEqual(['/old/ch.emilvinu.x'])
  homes.left = null
  await one.look()
  expect(one.left).toEqual(['/old/ch.emilvinu.x'])
})
test('speaks of one folder as one and of several as several, and the notice counts them without naming a path', async () => {
  const { leftWords } = await import('./former-left.svelte')
  expect(leftWords(1)).toEqual({
    title: 'Old folder',
    caption:
      'Orden could not move everything out of the folder it used before. Nothing was lost. What is left is still there.',
    toast:
      'Orden could not move everything out of the folder it used before. Nothing was lost. What is left is still in that folder, which Settings shows.',
  })
  expect(leftWords(3)).toEqual({
    title: 'Old folders',
    caption:
      'Orden could not move everything out of the folders it used before. Nothing was lost. What is left is still there.',
    toast:
      'Orden could not move everything out of the folders it used before. Nothing was lost. What is left is still in 3 folders, which Settings lists.',
  })
  const many = await launched(['/old/a', '/old/b'])
  expect(many.said.toast).toContain('2 folders')
  expect(many.said.toast).not.toContain('/old/')
})
