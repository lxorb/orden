import { beforeEach, expect, test, vi } from 'vitest'
import '../test/storage'

const rehomes = vi.hoisted(() => [] as (() => void)[])
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: (command: string) =>
    command === 'rehome_snapshots'
      ? new Promise((done) => rehomes.push(() => done(0)))
      : Promise.reject(new Error('no backend')),
}))

const page = new EventTarget()
vi.stubGlobal('window', page)

const { Protection, STORAGE_KEY } = await import('./protection.svelte')
const { keepingShared } = await import('../../file-ops/src/api')

const ROOT = '/space'
const DIARY = `${ROOT}/Diary.md`
const PLANS = `${ROOT}/Plans.md`
const OLD = `${ROOT}/Old/Diary.md`

const told = () => page.dispatchEvent(Object.assign(new Event('storage'), { key: STORAGE_KEY }))

beforeEach(() => {
  localStorage.clear()
  rehomes.length = 0
})

test('moves another window made and this one hears leave the locks where that window put them', () => {
  const second = new Protection()
  const main = new Protection()
  second.set(ROOT, DIARY, 'password')
  second.set(ROOT, PLANS, 'device')
  const first = { op: 'moved', from: DIARY, to: OLD, kind: 'file', root: ROOT, into: ROOT } as const
  const then = {
    op: 'moved',
    from: PLANS,
    to: DIARY,
    kind: 'file',
    root: ROOT,
    into: ROOT,
  } as const
  keepingShared(second)(first)
  keepingShared(second)(then)
  told()
  keepingShared(main)({ ...first, heard: true })
  keepingShared(main)({ ...then, heard: true })
  told()
  expect(main.ways(ROOT)).toEqual({ 'Old/Diary.md': 'password', 'Diary.md': 'device' })
  expect(main.agentsMay(DIARY)).toBe(false)
  expect(new Protection().ways(ROOT)).toEqual({ 'Old/Diary.md': 'password', 'Diary.md': 'device' })
})

test('a note renamed onto a deleted note’s name while its lock is still being buried keeps its lock', async () => {
  const protection = new Protection()
  protection.set(ROOT, DIARY, 'password')
  protection.set(ROOT, PLANS, 'device')
  const going = protection.gone(DIARY, ROOT, 'trash-1')
  for (let at = 0; at < 20 && !rehomes.length; at++) await new Promise((go) => setTimeout(go, 0))
  protection.moved(PLANS, DIARY, ROOT)
  rehomes.shift()?.()
  await going
  expect(protection.ways(ROOT)).toEqual({ 'Diary.md': 'device' })
  expect(protection.agentsMay(DIARY)).toBe(false)
})
