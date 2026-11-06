import type { ChatProvider, Connection, ProviderEvent } from '@orden/chats/provider'
import { afterEach, describe, expect, test } from 'vitest'
import { chats } from './store.svelte'
import { Connected } from './connected.svelte'
import { ordenConnection } from './providers/orden'
import { LUCILE, seeded } from './view/seed'
import { store, useStore } from './view/source.svelte'

afterEach(() => useStore(chats))

const host = {
  secret: () => Promise.resolve(null),
  keepSecret: () => Promise.resolve(),
  fetch: globalThis.fetch,
  now: () => 0,
}

function fakeProvider(): { provider: ChatProvider; say: (event: ProviderEvent) => void } {
  let hear: (event: ProviderEvent) => void = () => undefined
  const connection: Connection = {
    account: { id: 'me@example.org', label: 'me@example.org' },
    conversations: () =>
      Promise.resolve([
        { id: 't1', title: 'Lunch', kind: 'thread', people: [], lastAt: 5, unread: 0 },
      ]),
    history: () => Promise.resolve({ messages: [], before: null }),
    send: () => Promise.reject(new Error('no')),
    start: (listener) => {
      hear = listener
      return () => (hear = () => undefined)
    },
    attachment: () => Promise.reject(new Error('no')),
    close: () => Promise.resolve(),
  }
  return {
    provider: {
      id: 'fake',
      name: 'Fake',
      icon: '',
      fields: [],
      can: { send: false, attachments: false, live: true, replies: false },
      available: () => true,
      connect: () => Promise.resolve(connection),
    },
    say: (event) => hear(event),
  }
}

describe('connected chats', () => {
  test("Orden's own chats are listed as they are in the store, newest first", () => {
    const { store: fixture } = seeded()
    useStore(fixture)
    const rows = new Connected().rows()
    expect(rows.map((row) => row.conversation.id).sort()).toEqual(
      fixture.list.map((one) => one.id).sort(),
    )
    expect(rows.every((row) => row.provider === 'orden')).toBe(true)
    const times = rows.map((row) => row.conversation.lastAt ?? 0)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  test("an account's conversations join the list and follow its events", async () => {
    useStore(seeded().store)
    const hub = new Connected()
    const { provider, say } = fakeProvider()
    await hub.link(provider, {}, host)
    const mine = () => hub.rows().filter((row) => row.provider === 'fake')
    expect(mine().map((row) => row.conversation.title)).toEqual(['Lunch'])

    say({
      t: 'message',
      message: {
        id: 'm1',
        conversation: 't1',
        author: { id: 'a', name: 'A' },
        at: 9,
        text: 'at noon?\nsecond line',
        attachments: [],
        mine: false,
      },
    })
    expect(mine()[0]?.conversation).toMatchObject({ unread: 1, lastAt: 9, snippet: 'at noon?' })
    hub.seen('fake', 'me@example.org', 't1')
    expect(mine()[0]?.conversation.unread).toBe(0)

    say({ t: 'status', status: 'signed-out', reason: 'wrong password' })
    expect(hub.find('fake', 'me@example.org')).toMatchObject({
      status: 'signed-out',
      reason: 'wrong password',
    })
    say({ t: 'gone', conversation: 't1' })
    expect(mine()).toEqual([])

    await hub.unlink('fake', 'me@example.org')
    expect(hub.linked).toEqual([])
  })

  test("Orden's chats as a connection: listed, read, posted and heard", async () => {
    const { store: fixture, general } = seeded()
    useStore(fixture)
    const connection = ordenConnection(store)
    expect((await connection.conversations()).length).toBe(fixture.list.length)

    const heard: ProviderEvent[] = []
    const stop = connection.start((event) => heard.push(event))
    fixture.speak(general, LUCILE, 'hello from Lucile')
    const arrived = heard.find((event) => event.t === 'message')
    expect(arrived).toMatchObject({
      message: { conversation: general, text: 'hello from Lucile', mine: false },
    })
    expect(heard.some((event) => event.t === 'conversations')).toBe(true)
    stop()

    const sent = await connection.send(general, { text: 'and from me' })
    expect(sent).toMatchObject({ mine: true, text: 'and from me' })
    const page = await connection.history(general, { limit: 50 })
    expect(page.messages.some((one) => one.text === 'hello from Lucile')).toBe(true)
  })
})
