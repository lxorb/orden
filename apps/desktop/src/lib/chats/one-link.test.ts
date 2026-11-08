import { fakeProvider } from '@orden/chats/fake-provider'
import type { ChatProvider, Host, ProviderEvent } from '@orden/chats/provider'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Connected } from './connected.svelte'
import { type Line, OneLink } from './one-link'

interface Asking {
  name: string
  client: number
  grant: () => void
  signal?: AbortSignal
}

class Locks {
  private readonly held = new Map<string, number>()
  private readonly waiting: Asking[] = []

  as(client: number): LockManager {
    const request = (name: string, ...rest: unknown[]) => {
      const run = rest.at(-1) as (lock: { name: string } | null) => unknown
      const options = (rest.length > 1 ? rest[0] : {}) as LockOptions
      if (options.ifAvailable && this.held.has(name)) return Promise.resolve(run(null))
      return new Promise((resolve, reject) => {
        const asking: Asking = {
          name,
          client,
          ...(options.signal ? { signal: options.signal } : {}),
          grant: () => {
            this.held.set(name, client)
            Promise.resolve(run({ name }))
              .then(resolve, reject)
              .finally(() => {
                if (this.held.get(name) !== client) return
                this.held.delete(name)
                this.next()
              })
          },
        }
        options.signal?.addEventListener('abort', () => {
          const at = this.waiting.indexOf(asking)
          if (at < 0) return
          this.waiting.splice(at, 1)
          reject(new Error('aborted'))
        })
        this.waiting.push(asking)
        this.next()
      })
    }
    return { request } as unknown as LockManager
  }

  gone(client: number) {
    for (const [name, holder] of [...this.held]) if (holder === client) this.held.delete(name)
    this.waiting.splice(
      0,
      this.waiting.length,
      ...this.waiting.filter((one) => one.client !== client),
    )
    this.next()
  }

  private next() {
    for (const one of [...this.waiting]) {
      if (this.held.has(one.name)) continue
      this.waiting.splice(this.waiting.indexOf(one), 1)
      one.grant()
    }
  }
}

function bus() {
  const lines = new Map<string, (message: unknown) => void>()
  const line = (id: string, heard: (message: unknown) => void): Line => {
    lines.set(id, heard)
    return {
      post: (message) => {
        if (!lines.has(id)) return
        const copy = structuredClone(message)
        for (const [other, hear] of lines) if (other !== id) queueMicrotask(() => hear(copy))
      },
      close: () => lines.delete(id),
    }
  }
  return { line, cut: (id: string) => lines.delete(id) }
}

const host: Host = {
  secret: () => Promise.resolve(null),
  keepSecret: () => Promise.resolve(),
  fetch: globalThis.fetch,
  now: () => Date.now(),
}

const opened: Connected[] = []

afterEach(async () => {
  for (const one of opened.splice(0))
    for (const it of one.linked) await one.unlink(it.provider.id, it.account.id)
})

function windows(count: number) {
  const fake = fakeProvider()
  let dialled = 0
  const provider: ChatProvider = {
    ...fake,
    connect: (config, given, account) => {
      dialled += 1
      return fake.connect(config, given, account)
    },
  }
  const locks = new Locks()
  const { line, cut } = bus()
  const made = Array.from({ length: count }, (_, at) => {
    const id = `w${at + 1}`
    const link = new OneLink({
      id,
      locks: () => Promise.resolve(locks.as(at + 1)),
      line: (heard) => line(id, heard),
    })
    const hub = new Connected(
      (p, c, h, k, w) => link.dial(p, c, h, k, w),
      (p, a, work) => link.alone(p, a, work),
    )
    opened.push(hub)
    const heard: ProviderEvent[] = []
    hub.hear((_provider, _account, event) => heard.push(event))
    return { id, hub, heard, client: at + 1 }
  })
  return { fake, provider, made, dialled: () => dialled, locks, cut }
}

const said = (heard: readonly ProviderEvent[], text: string) =>
  heard.filter((one) => one.t === 'message' && one.message.text === text).length

describe('one connection per account across windows', () => {
  test('three windows share one connection, each hears every message once, and any can send', async () => {
    const { fake, provider, made, dialled } = windows(3)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    fake.connection = null
    const linked = await Promise.all(
      made.map(({ hub }) => hub.link(provider, { name: 'acct' }, host, account)),
    )
    expect(dialled()).toBe(1)
    for (const one of linked) expect(one.conversations.map((it) => it.id)).toContain('ada')
    for (const { hub } of made)
      expect(typeof hub.find(provider.id, account)?.connection.react).toBe('function')

    fake.world.say('ada', 'ada', 'hello all')
    await vi.waitFor(() => {
      for (const { heard } of made) expect(said(heard, 'hello all')).toBe(1)
    })

    const sent = await made[2]?.hub.find(provider.id, account)?.connection.send('ada', {
      text: 'from the third',
    })
    expect(sent?.text).toBe('from the third')
    expect(fake.world.calls.filter((one) => one.method === 'send')).toHaveLength(1)
    await vi.waitFor(() => {
      for (const { heard } of made) expect(said(heard, 'from the third')).toBe(1)
    })
  })

  test('when the leading window dies another takes the connection, and nothing is heard twice', async () => {
    const { fake, provider, made, dialled, locks, cut } = windows(3)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    const [first, second, third] = made
    if (!first || !second || !third) throw new Error('no windows')
    await first.hub.link(provider, { name: 'acct' }, host, account)
    await second.hub.link(provider, { name: 'acct' }, host, account)
    await third.hub.link(provider, { name: 'acct' }, host, account)
    expect(dialled()).toBe(1)

    cut(first.id)
    locks.gone(first.client)
    await vi.waitFor(() =>
      expect(
        [...second.heard, ...third.heard].some(
          (one) => one.t === 'status' && one.status === 'connecting',
        ),
      ).toBe(true),
    )
    expect(dialled()).toBe(2)

    fake.world.say('ada', 'ada', 'after the handover')
    await vi.waitFor(() => {
      expect(said(second.heard, 'after the handover')).toBe(1)
      expect(said(third.heard, 'after the handover')).toBe(1)
    })
    const sent = await third.hub
      .find(provider.id, account)
      ?.connection.send('ada', { text: 'still sending' })
    expect(sent?.text).toBe('still sending')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(said(second.heard, 'after the handover')).toBe(1)
    expect(said(third.heard, 'after the handover')).toBe(1)
    expect(dialled()).toBe(2)
  })

  test('a window that lets its account go hands it to the next, which goes on', async () => {
    const { fake, provider, made, dialled } = windows(2)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    const [first, second] = made
    if (!first || !second) throw new Error('no windows')
    await first.hub.link(provider, { name: 'acct' }, host, account)
    await second.hub.link(provider, { name: 'acct' }, host, account)
    await first.hub.unlink(provider.id, account)
    await vi.waitFor(() => expect(dialled()).toBe(2))
    fake.world.say('ada', 'ada', 'second leads')
    await vi.waitFor(() => expect(said(second.heard, 'second leads')).toBe(1))
  })

  test('an account no longer wanted is not taken over', async () => {
    const { fake, provider, made, dialled } = windows(2)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    const [first, second] = made
    if (!first || !second) throw new Error('no windows')
    await first.hub.link(provider, { name: 'acct' }, host, account)
    await second.hub.link(provider, { name: 'acct' }, host, account)
    second.hub.wanted = () => false
    await first.hub.unlink(provider.id, account)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(dialled()).toBe(1)
  })

  test('signing in afresh in one window takes the account over from the window that held it', async () => {
    const { fake, provider, made, dialled } = windows(2)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    const [first, second] = made
    if (!first || !second) throw new Error('no windows')
    await first.hub.link(provider, { name: 'acct' }, host, account)
    await second.hub.link(provider, { name: 'acct' }, host)
    expect(dialled()).toBe(2)
    fake.world.say('ada', 'ada', 'new leader')
    await vi.waitFor(() => {
      expect(said(first.heard, 'new leader')).toBe(1)
      expect(said(second.heard, 'new leader')).toBe(1)
    })
  })

  test('without working locks each window connects on its own as before', async () => {
    const fake = fakeProvider()
    const link = new OneLink({ id: 'w', locks: () => Promise.resolve(null), line: () => null })
    const hub = new Connected((p, c, h, k, w) => link.dial(p, c, h, k, w))
    opened.push(hub)
    const linked = await hub.link(fake, { name: 'acct' }, host)
    expect(linked.conversations.length).toBeGreaterThan(0)
  })
})

describe('forgetting an account', () => {
  test('is done only once no window holds its connection', async () => {
    const { fake, provider, made } = windows(2)
    const account = (await fake.connect({ name: 'acct' }, host)).account.id
    const [first, second] = made
    if (!first || !second) throw new Error('no windows')
    await first.hub.link(provider, { name: 'acct' }, host, account)
    await second.hub.link(provider, { name: 'acct' }, host, account)
    second.hub.wanted = () => false
    first.hub.wanted = () => false
    let forgotten = false
    const forgetting = second.hub.alone(provider.id, account, () => {
      forgotten = true
      return Promise.resolve()
    })
    await second.hub.unlink(provider.id, account)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(forgotten).toBe(false)
    await first.hub.unlink(provider.id, account)
    await forgetting
    expect(forgotten).toBe(true)
  })
})
