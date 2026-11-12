// @vitest-environment jsdom
import type { Message } from '@orden/chats'
import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  hear: null as null | ((chat: string, messages: readonly Message[]) => void),
  asked: 0,
  read: 0,
  newest: 0,
}))

vi.mock('../ai/complete', () => ({
  complete: async () => {
    world.asked++
    await new Promise((resolve) => setTimeout(resolve, 5))
    return 'urgent'
  },
}))
vi.mock('../ai/store.svelte', () => ({ ai: { providerFor: () => ({ model: 'small' }) } }))

const said = (at: number, author = 'user:lucile'): Message =>
  ({
    id: `m${String(at)}`,
    seq: at,
    author,
    at,
    body: `message ${String(at)}`,
    files: [],
    deleted: false,
  }) as unknown as Message

vi.mock('./view/source.svelte', () => ({
  store: () => ({
    me: 'user:me',
    entry: () => ({ name: 'Lunch' }),
    heard: (listener: NonNullable<typeof world.hear>) => {
      world.hear = listener
      return () => undefined
    },
    history: async () => {
      world.read++
      await new Promise((resolve) => setTimeout(resolve, 1))
      return Array.from({ length: world.newest }, (_, at) => said(at + 1))
    },
  }),
}))

const { priorities } = await import('./priorities.svelte')
const { EXPERIMENTAL_WORD, CHATS_WORD, hiddenKinds } = await import('../settings.svelte')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
const { heardOf, startPriorities } = await import('./prioritise')

test('a burst of messages in one Orden chat is weighed once, not once a message', async () => {
  priorities.setOn(true)
  startPriorities()

  for (let at = 1; at <= 20; at++) {
    world.newest = at
    world.hear?.('c', [said(at)])
  }
  await vi.waitFor(() => expect(priorities.levelOf('c')).toBe('urgent'))
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(world.asked).toBeLessThanOrEqual(2)
  expect(world.read).toBeLessThanOrEqual(2)
})

test('only my own words arriving ask nothing', async () => {
  const before = world.read
  world.hear?.('c', [said(30, 'user:me')])
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(world.read).toBe(before)
})

test('a deleted message says nothing, and mine is marked as mine', () => {
  const gone = { ...said(1), deleted: true } as Message
  expect(heardOf([gone, said(2, 'user:me')], 'user:me')).toEqual([
    { from: 'user:lucile', words: '', mine: false, at: 1 },
    { from: 'user:me', words: 'message 2', mine: true, at: 2 },
  ])
})
