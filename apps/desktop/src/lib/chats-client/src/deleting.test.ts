import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  answer: false,
  asked: [] as { title: string; detail: string | undefined }[],
  list: [] as { path: string | null; name: string | null; lastSeq: number }[],
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
const { mayDelete } = await import('./deleting')
beforeEach(() => {
  world.answer = false
  world.asked = []
  world.list = [
    { path: '/space/Plans.chat', name: 'Plans', lastSeq: 12 },
    { path: '/space/Quiet.chat', name: 'Quiet', lastSeq: 0 },
    { path: '/space/Trip.chat', name: 'Trip', lastSeq: 3 },
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
