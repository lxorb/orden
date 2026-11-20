import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  answer: false,
  asked: [] as { title: string; detail: string | undefined }[],
  list: [] as { id?: string; path: string | null; name: string | null; lastSeq: number }[],
  ended: [] as string[],
}))
vi.mock('../../ui-kit/src/api', () => ({
  prompt: {
    confirm: (options: { title: string; detail?: string }) => {
      world.asked.push({ title: options.title, detail: options.detail })
      return Promise.resolve(world.answer)
    },
  },
}))
vi.mock('./store.svelte', () => ({
  chats: {
    get list() {
      return world.list
    },
  },
}))
vi.mock('./http', () => ({
  endChat: (chat: string) => {
    world.ended.push(chat)
    return Promise.resolve(true)
  },
}))
const { mayDelete, pointersGone } = await import('./deleting')
beforeEach(() => {
  world.answer = false
  world.asked = []
  world.ended = []
  world.list = [
    { id: 'c_plans', path: '/space/Plans.chat', name: 'Plans', lastSeq: 12 },
    { id: 'c_quiet', path: '/space/Quiet.chat', name: 'Quiet', lastSeq: 0 },
    { id: 'c_trip', path: '/space/Trip.chat', name: 'Trip', lastSeq: 3 },
  ]
})
describe('deleting a chat', () => {
  test('with no messages goes without a word', async () => {
    expect(await mayDelete(['/space/Quiet.chat', '/space/Notes.md'])).toBe(true)
    expect(world.asked).toEqual([])
  })
  test('with messages asks first, by its name, and Cancel keeps it', async () => {
    expect(await mayDelete(['/space/Plans.chat'])).toBe(false)
    expect(world.asked.map((one) => one.title)).toEqual(['Delete Plans?'])
    expect(world.asked[0]?.detail).toContain('Recently deleted')
    world.answer = true
    expect(await mayDelete(['/space/Plans.chat'])).toBe(true)
  })
  test('asks once for every chat with messages a gesture deletes', async () => {
    world.answer = true
    expect(await mayDelete(['/space/Plans.chat', '/space/Trip.chat', '/space/Quiet.chat'])).toBe(true)
    expect(world.asked.map((one) => one.title)).toEqual(['Delete 2 chats with messages?'])
  })
})
test('every way the sidebar deletes asks through it', () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8')
  const menu = read('../../row-menu/src/row-menu.ts')
  expect(menu).toMatch(/if \(!inside\) \{\s*if \(await chatsKept\(\[entry\.path\]\)\) return/)
  expect(menu).toContain('run: () => void removeAsking(paths)')
  expect(read('../../sidebar/src/Tree.svelte')).toContain('one.removeAsking(going)')
})
describe('a chat deleted here (#2321)', () => {
  test('is ended on the account once its pointer is gone, so no device lists it again', async () => {
    expect(await mayDelete(['/space/Quiet.chat'])).toBe(true)
    pointersGone('/space/Quiet.chat', false)
    expect(world.ended).toEqual(['c_quiet'])
  })
  test('in a folder deleted here, is ended with the folder', async () => {
    world.answer = true
    expect(await mayDelete(['/space/Plans.chat', '/space/Trip.chat'])).toBe(true)
    pointersGone('/space', true)
    expect(world.ended.sort()).toEqual(['c_plans', 'c_trip'])
  })
  test('is not ended when the deleting is called off, nor by a pointer another device deleted', async () => {
    expect(await mayDelete(['/space/Plans.chat'])).toBe(false)
    pointersGone('/space/Plans.chat', false)
    pointersGone('/space/Trip.chat', false)
    expect(world.ended).toEqual([])
  })
})
