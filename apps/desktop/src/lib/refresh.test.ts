import { beforeEach, expect, test, vi } from 'vitest'

const place = vi.hoisted(() => ({ active: null as { id: string; kind: string } | null }))
const steps = vi.hoisted(() => [] as string[])
const syncing = vi.hoisted(() => ({ passes: 0, status: 'idle', lastError: null as string | null }))

vi.mock('./workspace.svelte', () => ({ workspace: place }))
vi.mock('./web-tab/pages.svelte', () => ({
  pages: {
    step: (id: string, how: string) => {
      steps.push(`${id}:${how}`)
      return Promise.resolve()
    },
  },
}))
vi.mock('./sync.svelte', () => ({
  sync: {
    get status() {
      return syncing.status
    },
    get lastError() {
      return syncing.lastError
    },
    pass: () => {
      syncing.passes++
      return Promise.resolve(true)
    },
  },
}))

const { refreshHere } = await import('./refresh')

beforeEach(() => {
  steps.length = 0
  syncing.passes = 0
  syncing.status = 'idle'
})

test('a web tab in front reloads its page, and syncs nothing', async () => {
  place.active = { id: 'w1', kind: 'web' }
  await refreshHere()
  expect(steps).toEqual(['w1:reload'])
  expect(syncing.passes).toBe(0)
})

test('a note, or nothing in front, syncs now', async () => {
  for (const active of [{ id: 'n1', kind: 'note' }, null]) {
    place.active = active
    await refreshHere()
  }
  expect(syncing.passes).toBe(2)
  expect(steps).toEqual([])
})

test('a pass that did not get through says so', async () => {
  place.active = { id: 'n1', kind: 'note' }
  syncing.status = 'offline'
  await expect(refreshHere()).rejects.toThrow()
})
