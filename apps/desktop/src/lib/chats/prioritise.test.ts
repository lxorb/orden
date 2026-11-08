// @vitest-environment jsdom
import type { ProviderEvent, ProviderMessage } from '@orden/chats/provider'
import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  hear: null as null | ((provider: string, account: string, event: ProviderEvent) => void),
  asked: 0,
  read: 0,
  told: [] as string[],
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
vi.mock('../notify', () => ({
  show: (notice: { body: string }) => world.told.push(notice.body),
  unshow: () => undefined,
}))
vi.mock('./linked', () => ({ openConversation: () => undefined }))
vi.mock('./providers/orden', () => ({
  ORDEN: 'orden',
  ordenConnection: () => ({ start: () => () => undefined }),
}))
vi.mock('./view/source.svelte', () => ({ store: () => ({ entry: () => null }) }))

const said = (at: number): ProviderMessage => ({
  id: `m${String(at)}`,
  conversation: 'c',
  author: { id: 'lucile', name: 'Lucile' },
  at,
  text: `message ${String(at)}`,
  attachments: [],
  mine: false,
})

vi.mock('./connected.svelte', () => ({
  connected: {
    hear: (listener: NonNullable<typeof world.hear>) => {
      const before = world.hear
      world.hear = (provider, account, event) => {
        before?.(provider, account, event)
        listener(provider, account, event)
      }
      return () => undefined
    },
    find: () => ({
      conversations: [{ id: 'c', title: 'Lucile', people: [] }],
      connection: {
        history: async () => {
          world.read++
          await new Promise((resolve) => setTimeout(resolve, 1))
          return {
            messages: Array.from({ length: world.newest }, (_, at) => said(at + 1)),
          }
        },
      },
    }),
  },
}))

const { priorities } = await import('./priorities.svelte')
const { EXPERIMENTAL_WORD, CHATS_WORD, hiddenKinds } = await import('../settings.svelte')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
const { startPriorities } = await import('./prioritise')

test('a burst of messages in one chat is weighed once, not once a message', async () => {
  priorities.setOn(true)
  startPriorities()

  for (let at = 1; at <= 20; at++) {
    world.newest = at
    world.hear?.('mail', 'me', { t: 'message', message: said(at) })
  }
  await vi.waitFor(() => expect(world.told).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(world.asked).toBeLessThanOrEqual(2)
  expect(world.read).toBeLessThanOrEqual(2)
  expect(world.told).toEqual(['Lucile: message 20'])
  expect(priorities.levelOf('mail\nme\nc')).toBe('urgent')
})

test('without priorities a message from another service is still told, and its own words show', async () => {
  priorities.setOn(false)
  startPriorities()
  world.told.length = 0
  world.hear?.('mail', 'me', { t: 'message', message: { ...said(99), text: 'are you in?' } })
  await vi.waitFor(() => expect(world.told).toEqual(['Lucile: are you in?']))
  world.hear?.('mail', 'me', {
    t: 'message',
    message: { ...said(100), text: 'not this', mine: true },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(world.told).toEqual(['Lucile: are you in?'])
})
