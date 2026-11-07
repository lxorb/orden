// @vitest-environment jsdom
import type { ChatProvider, Connection, Host } from '@orden/chats/provider'
import { secretName } from '@orden/chats/provider'
import { beforeEach, describe, expect, test } from 'vitest'
import { Accounts } from './accounts.svelte'
import { Connected } from './connected.svelte'
import { conversationKey, conversationKeyOf } from './conversation-key'

const vault = new Map<string, string>()
const host: Host = {
  secret: (name) => Promise.resolve(vault.get(name) ?? null),
  keepSecret: (name, value) => {
    if (value === null) vault.delete(name)
    else vault.set(name, value)
    return Promise.resolve()
  },
  socket: () => Promise.reject(new Error('none here')),
  fetch: globalThis.fetch,
  now: () => 0,
}

const given: Record<string, string>[] = []

const provider: ChatProvider = {
  id: 'fake',
  name: 'Fake',
  icon: '',
  fields: [
    { key: 'address', label: 'Email address', kind: 'email' },
    { key: 'password', label: 'Password', kind: 'password', secret: true },
  ],
  can: { send: true, attachments: false, live: true, replies: false },
  available: () => true,
  connect(values) {
    given.push({ ...values })
    if (values.password !== 'right') return Promise.reject(new Error('Invalid credentials'))
    const connection: Connection = {
      account: { id: values.address ?? '', label: values.address ?? '' },
      conversations: () => Promise.resolve([]),
      history: () => Promise.resolve({ messages: [], before: null }),
      send: () => Promise.reject(new Error('no')),
      start: () => () => undefined,
      attachment: () => Promise.reject(new Error('no')),
      close: () => Promise.resolve(),
    }
    return Promise.resolve(connection)
  },
}

beforeEach(() => {
  vault.clear()
  given.length = 0
  localStorage.clear()
})

describe("other services' accounts", () => {
  test('a secret goes to the vault and nowhere else; the rest is kept without it', async () => {
    const hub = new Connected()
    const accounts = new Accounts(host, hub, [provider])
    expect(await accounts.connect('fake', { address: 'a@x.org', password: 'right' })).toBeNull()
    expect(vault.get(secretName('fake', 'a@x.org', 'password'))).toBe('right')
    expect(accounts.saved).toEqual([
      { provider: 'fake', account: 'a@x.org', config: { address: 'a@x.org' } },
    ])
    expect(JSON.stringify(localStorage)).not.toContain('right')
    expect(hub.find('fake', 'a@x.org')).toBeDefined()
  })

  test('a refusal is said, and nothing is kept', async () => {
    const accounts = new Accounts(host, new Connected(), [provider])
    expect(await accounts.connect('fake', { address: 'a@x.org', password: 'wrong' })).toBe(
      'Invalid credentials',
    )
    expect(accounts.saved).toEqual([])
    expect(vault.size).toBe(0)
  })

  test('the next launch links them again with the secret from the vault', async () => {
    await new Accounts(host, new Connected(), [provider]).connect('fake', {
      address: 'a@x.org',
      password: 'right',
    })
    given.length = 0
    const hub = new Connected()
    const next = new Accounts(host, hub, [provider])
    next.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(given).toEqual([{ address: 'a@x.org', password: 'right' }])
    expect(hub.find('fake', 'a@x.org')).toBeDefined()

    await next.disconnect('fake', 'a@x.org')
    expect(vault.size).toBe(0)
    expect(next.saved).toEqual([])
    expect(hub.linked).toEqual([])
  })

  test('a saved account the vault no longer opens is listed as failed', async () => {
    await new Accounts(host, new Connected(), [provider]).connect('fake', {
      address: 'a@x.org',
      password: 'right',
    })
    vault.clear()
    const accounts = new Accounts(host, new Connected(), [provider])
    accounts.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(accounts.failed).toMatchObject([{ provider: 'fake', account: 'a@x.org' }])
  })

  test('what a sign-in in the browser learnt is kept for the next launch, and what it keeps itself is forgotten on disconnect', async () => {
    const signedIn: ChatProvider = {
      ...provider,
      id: 'browser',
      fields: [{ key: 'name', label: 'Your name', kind: 'text', optional: true }],
      kept: ['refresh'],
      async connect(values, given) {
        const address = values.address ?? 'b@x.org'
        if (!values.address) await given.keepSecret(secretName('browser', address, 'refresh'), 'r')
        const connection = await provider.connect({ address, password: 'right' }, given)
        return { ...connection, account: { ...connection.account, keep: { address } } }
      },
    }
    const hub = new Connected()
    const accounts = new Accounts(host, hub, [signedIn])
    expect(await accounts.connect('browser', { name: 'Bo' })).toBeNull()
    expect(accounts.saved).toEqual([
      { provider: 'browser', account: 'b@x.org', config: { address: 'b@x.org', name: 'Bo' } },
    ])
    expect([...vault.keys()]).toEqual([secretName('browser', 'b@x.org', 'refresh')])

    given.length = 0
    const next = new Accounts(host, new Connected(), [signedIn])
    next.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(given).toEqual([{ address: 'b@x.org', password: 'right' }])

    await next.disconnect('browser', 'b@x.org')
    expect(vault.size).toBe(0)
    expect(next.saved).toEqual([])
  })

  test('a service keeping its own session is told the account when linked again, and forgets it on disconnect', async () => {
    const known: (string | undefined)[] = []
    const forgotten: string[] = []
    const own: ChatProvider = {
      ...provider,
      id: 'own',
      fields: [{ key: 'address', label: 'Email address', kind: 'email' }],
      connect: (values, given, account) => {
        known.push(account)
        return provider.connect({ ...values, password: 'right' }, given)
      },
      forget: (account) => {
        forgotten.push(account)
        return Promise.resolve()
      },
    }
    await new Accounts(host, new Connected(), [own]).connect('own', { address: 'a@x.org' })
    const next = new Accounts(host, new Connected(), [own])
    next.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(known).toEqual([undefined, 'a@x.org'])
    await next.disconnect('own', 'a@x.org')
    expect(forgotten).toEqual(['a@x.org'])
  })

  test("a conversation tab's words name it, and nothing else reads as one", () => {
    const key = { provider: 'mail', account: 'a@x.org', conversation: 'id\nwith a break@x' }
    expect(conversationKeyOf(conversationKey(key))).toEqual(key)
    expect(conversationKeyOf('')).toBeNull()
    expect(conversationKeyOf('# a note')).toBeNull()
  })
})
