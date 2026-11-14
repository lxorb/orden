import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  shared: JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: 'a link' }] }),
  asked: 0,
  done: 0,
  handed: null as (() => void) | null,
}))

vi.mock('../sharing/src/api', () => ({ canWriteAt: () => true }))
vi.mock('../import/src/apply', () => ({
  applyImport: () => Promise.resolve({ paths: [], stepped: 0 }),
}))
vi.mock('../platform/src/mobile-bridge', () => ({
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
vi.mock('../commands', () => ({ appCommands: () => [] }))
vi.mock('../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../ui-kit/src/prompt.svelte', () => ({
  prompt: {
    choose: async () => {
      world.asked++
      await new Promise((done) => setTimeout(done, 30))
      return 'new'
    },
  },
}))
vi.mock('../workspace.svelte', () => ({
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
