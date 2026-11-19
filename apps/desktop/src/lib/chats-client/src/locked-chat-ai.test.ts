// @vitest-environment jsdom
import type { Message } from '@orden/chats'
import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  hear: null as null | ((chat: string, messages: readonly Message[]) => void),
  asked: 0,
  read: 0,
}))
const THERAPY = { id: 'c', name: 'therapy', root: '/s/Work', path: '/s/Work/Private/therapy.chat' }
vi.mock('../../protect/src/api', async (original) => ({
  ...(await original<typeof import('../../protect/src/api')>()),
  protection: { agentsMay: (path: string) => !path.includes('/Private') },
}))
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  complete: async () => {
    world.asked++
    return 'urgent'
  },
  ai: { providerFor: () => ({ model: 'small' }) },
}))
const said: Message = {
  id: 'm1',
  seq: 1,
  author: 'user:lucile',
  at: 1,
  body: 'the session notes',
  files: [],
  deleted: false,
} as unknown as Message
const store = {
  me: 'user:me',
  entry: () => ({ ...THERAPY, readSeq: 0 }),
  heard: (listener: NonNullable<typeof world.hear>) => {
    world.hear = listener
    return () => undefined
  },
  history: async () => {
    world.read++
    return [said]
  },
  members: async () => [],
}
vi.mock('./view/source.svelte', () => ({ store: () => store }))
vi.mock('./store.svelte', () => ({ chats: store }))
const { priorities } = await import('./priorities.svelte')
const { EXPERIMENTAL_WORD, CHATS_WORD, hiddenKinds } = await import('../../gates/src/api')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
const { startPriorities } = await import('./prioritise')
const { chatPart } = await import('./context')
test('a chat shut to agents is never weighed in the background nor caught up on by the chat', async () => {
  priorities.setOn(true)
  startPriorities()
  world.hear?.('c', [said])
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(world.read).toBe(0)
  expect(world.asked).toBe(0)
  expect(await chatPart('c', 'unread-or-newest')).toBeNull()
})
