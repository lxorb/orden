import { beforeEach, expect, test, vi } from 'vitest'
import '../test/storage'

const page = new EventTarget()
vi.stubGlobal('window', page)
const { Protection, STORAGE_KEY } = await import('./protection.svelte')
const ROOT = '/space'
const DIARY = `${ROOT}/Diary.md`
const told = (key: string) => page.dispatchEvent(Object.assign(new Event('storage'), { key }))
beforeEach(() => localStorage.clear())
test('a lock set in another window shuts the note to agents here', () => {
  const main = new Protection()
  const second = new Protection()
  second.set(ROOT, DIARY, 'password')
  told(STORAGE_KEY)
  expect(main.agentsMay(DIARY)).toBe(false)
  expect(main.locked(DIARY)).toBe(true)
})
test('a lock changed here keeps the locks another window set before it was heard', () => {
  const main = new Protection()
  const second = new Protection()
  second.set(ROOT, DIARY, 'password')
  main.set(ROOT, `${ROOT}/Other.md`, 'device')
  expect(new Protection().ways(ROOT)).toEqual({ 'Diary.md': 'password', 'Other.md': 'device' })
})
test('a lock taken off in another window is off here too', () => {
  const main = new Protection()
  main.set(ROOT, DIARY, 'password')
  const second = new Protection()
  second.set(ROOT, DIARY, null)
  told(STORAGE_KEY)
  expect(main.locked(DIARY)).toBe(false)
  main.set(ROOT, `${ROOT}/Other.md`, 'device')
  expect(new Protection().ways(ROOT)).toEqual({ 'Other.md': 'device' })
})
