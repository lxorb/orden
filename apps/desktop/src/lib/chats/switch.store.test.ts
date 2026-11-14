import { beforeEach, expect, test, vi } from 'vitest'

const CHAT = `c_${'1'.repeat(32)}`

const sent = vi.hoisted(() => ({ by: [] as string[] }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))

vi.mock('./http', async (importOriginal) => {
  const { account } = await import('../accounts/src/account.svelte')
  return {
    ...(await importOriginal<typeof import('./http')>()),
    listChats: () => Promise.resolve(null),
    eventsOf: () => Promise.resolve(null),
    stateOf: () => Promise.resolve(null),
    postRead: () => Promise.resolve(true),
    sendEvents: (_chat: string, events: { id: string }[]) => {
      sent.by.push(account.user?.id ?? '')
      return Promise.resolve({ results: events.map((one, at) => ({ id: one.id, seq: at + 1 })) })
    },
  }
})

const { chats } = await import('./store.svelte')
const { account } = await import('../accounts/src/account.svelte')

const signedIn = (id: string) => {
  account.user = { id, email: `${id}@example.com`, name: null }
}

beforeEach(async () => {
  await chats.forget()
  sent.by = []
})

test('what one account queued is not sent while another account is signed in', async () => {
  signedIn('ana')
  await chats.start('ana')
  signedIn('bo')

  await chats.send(CHAT, { kind: 'post', id: 'e1', message: 'm1', body: 'from ana' })

  expect(sent.by).toEqual([])
})

test('what the signed-in account queued is sent', async () => {
  signedIn('ana')
  await chats.start('ana')

  await chats.send(CHAT, { kind: 'post', id: 'e1', message: 'm1', body: 'from ana' })

  await vi.waitFor(() => expect(sent.by).toEqual(['ana']))
})
