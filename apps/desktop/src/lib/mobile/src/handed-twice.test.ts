import { providePort } from '@orden/contracts'
import { expect, test, vi } from 'vitest'
import { readShared } from '../../import/src/api'

const world = vi.hoisted(() => ({
  shared: JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: 'a link' }] }),
  asked: 0,
  done: 0,
  handed: null as (() => void) | null,
}))
vi.mock('../../sharing/src/api', () => ({ canWriteAt: () => true }))
providePort('import.bring', {
  here: () => Promise.resolve(new Set()),
  browser: () => Promise.resolve([]),
  notes: () => Promise.resolve({ picked: false, trouble: null }),
  shared: (json) => Promise.resolve(readShared(json)),
  landShared: () => Promise.resolve(null),
})
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  onTheActivity: () => true,
  frameWord: () => Promise.resolve('word'),
  wordSaid: () => new Promise(() => undefined),
  method: (name: string) =>
    ({
      handed: () => '',
      shared: () => world.shared,
      sharedBytes: () => '',
      sharedDone: () => {
        world.shared = ''
        world.done++
      },
    })[name],
  answer: (_name: string, heard: (() => void) | undefined) => {
    world.handed = heard ?? null
  },
}))
vi.mock('./widgets.svelte', () => ({ watchWidgets: () => () => undefined }))
vi.mock('../../commands/src/api', () => ({ appCommands: () => [] }))
vi.mock('../../panes/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../panes/src/api')>()),
  views: { of: () => null },
}))
vi.mock('../../ui-kit/src/api', async (original) => ({
  ...(await original<typeof import('../../ui-kit/src/api')>()),
  prompt: {
    choose: async () => {
      world.asked++
      await new Promise((done) => setTimeout(done, 30))
      return 'new'
    },
  },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [{ id: 'mine', name: 'Mine', root: '/mine' }],
    activeSpace: { id: 'mine', name: 'Mine', root: '/mine' },
    active: null,
    panes: { focusedId: 'a' },
    open: () => Promise.resolve(),
    openEntry: () => Promise.resolve(),
  },
}))
const { startHanded } = await import('./handed')
test('a share handed while the page starts, and heard again in the same moment, is asked about once', async () => {
  const stop = startHanded()
  world.handed?.()
  world.handed?.()
  await vi.waitFor(() => expect(world.done).toBe(1))
  await new Promise((done) => setTimeout(done, 100))
  expect(world.asked).toBe(1)
  expect(world.done).toBe(1)
  stop()
})
