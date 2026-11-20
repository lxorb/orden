import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Provider } from '../../../ai-providers/src/providers'
import type { Mode, Thread } from '../../../ai-providers/src/chat/types'

const CLAUDE: Provider = { id: 'claude-code', kind: 'claude-code', name: '', model: '' }
const world = vi.hoisted(() => ({ adopted: [] as Thread[] }))
vi.mock('../store/chat.svelte', () => ({
  chat: {
    threadOf: () => null,
    loadModels: () => Promise.resolve([]),
    adopt: (thread: Thread) => world.adopted.push(thread),
    turn: () => Promise.resolve({ stop: 'end', turn: null, usage: null }),
  },
}))
vi.mock('../commands/found', () => ({
  rootOfSpace: () => '/n',
  foundNamed: () => Promise.resolve(null),
  wordsOf: () => Promise.resolve(''),
}))
vi.mock('../../../workspace/src/api', () => ({
  workspace: {
    spaces: [
      { id: 'Notes', root: '/n' },
      { id: 'Work', root: '/w' },
    ],
    activeSpace: { id: 'Notes' },
  },
}))
vi.mock('../../../ai-providers/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ai-providers/src/api')>()),
  ai: { providers: [CLAUDE] },
  usable: () => true,
}))
const { runAgent } = await import('./run')
const { helpers } = await import('./helpers.svelte')
afterEach(() => {
  for (const one of helpers.all) helpers.stop(one.id)
  helpers.all = []
  world.adopted.length = 0
})
describe('a helper whose parent chat lives in another window', () => {
  test.each<Mode>(['plan', 'approve'])('works in the asker’s %s mode, never a wider one', async (mode) => {
    const said = await runAgent({ prompt: 'Find the herons.' }, { thread: 'plan-thread-in-window-2', mode })
    expect(said).not.toHaveProperty('refused')
    expect(world.adopted.map((one) => one.mode)).toEqual([mode])
  })
})
describe('a helper whose parent chat lives in another window, told what that chat may use', () => {
  const asker = { thread: 'chat-in-window-2', mode: 'auto' as const }
  test('keeps out what its chat keeps out and uses only what its chat may', async () => {
    await runAgent(
      { prompt: 'Find the herons.' },
      { ...asker, without: ['edit_note'], only: ['read_note', 'edit_note'] },
    )
    expect(world.adopted[0]?.without).toContain('edit_note')
    expect(world.adopted[0]?.only).toEqual(['read_note', 'edit_note'])
  })
  test('may use no tool where its chat may use none', async () => {
    await runAgent({ prompt: 'Find the herons.' }, { ...asker, only: [] })
    expect(world.adopted[0]?.only).toEqual([])
  })
  test('works in its chat’s space, and is refused for a space this window does not have', async () => {
    await runAgent({ prompt: 'Find the herons.' }, { ...asker, space: 'Work' })
    expect(world.adopted[0]?.space).toBe('Work')
    const said = await runAgent({ prompt: 'Find the herons.' }, { ...asker, space: 'Elsewhere' })
    expect(said).toMatchObject({ refused: expect.stringContaining('Elsewhere') })
    expect(world.adopted).toHaveLength(1)
  })
})
