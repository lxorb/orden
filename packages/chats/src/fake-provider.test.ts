import { describe, expect, test } from 'vitest'
import { EVERYTHING, fakeProvider, OPTIONAL, SEND_ONLY } from './fake-provider'
import type { Host, ProviderEvent } from './provider'

function hostWith(more: Partial<Host> = {}): Host {
  return {
    secret: () => Promise.resolve(null),
    keepSecret: () => Promise.resolve(),
    fetch: globalThis.fetch,
    now: () => 0,
    ...more,
  }
}

describe('the fake provider', () => {
  test('a full one has every optional method, a bare one none of them', async () => {
    const full = await fakeProvider().connect({ name: 'a' }, hostWith())
    for (const method of OPTIONAL) expect(full).toHaveProperty(method)
    const bare = await fakeProvider({ can: SEND_ONLY, methods: [] }).connect({}, hostWith())
    for (const method of OPTIONAL) expect(bare).not.toHaveProperty(method)
    expect(bare).toHaveProperty('send')
  })

  test('sending tells the message, then that it was delivered', async () => {
    const fake = fakeProvider()
    const connection = await fake.connect({ name: 'a' }, hostWith())
    const heard: ProviderEvent[] = []
    connection.start((event) => heard.push(event))
    const sent = await connection.send('ada', { text: 'hi' })
    expect(sent.delivery).toBe('delivered')
    expect(heard.map((one) => one.t)).toEqual(['status', 'message', 'changed'])
  })

  test('one reaction each replaces the last, and removing for me hides only here', async () => {
    const fake = fakeProvider({ can: { ...EVERYTHING, reactions: 'one' } })
    const connection = await fake.connect({ name: 'a' }, hostWith())
    const [first] = (await connection.history('ada', { limit: 10 })).messages
    if (!first) throw new Error('no message')
    await connection.react?.('ada', first.id, '👍', true)
    await connection.react?.('ada', first.id, '🎉', true)
    expect(fake.world.held('ada', first.id).message.reactions).toEqual({ '🎉': ['me'] })
    const heard: ProviderEvent[] = []
    connection.start((event) => heard.push(event))
    await connection.remove?.('ada', first.id, false)
    expect(heard.at(-1)).toEqual({ t: 'deleted', conversation: 'ada', message: first.id })
  })

  test('signs in with a code it asks for, and refuses a wrong one', async () => {
    const asked: string[] = []
    const fake = fakeProvider({ signIn: 'code' })
    const host = hostWith({
      ask: (prompt) => {
        asked.push(prompt.kind)
        return Promise.resolve(asked.length === 1 ? '00000' : '12345')
      },
    })
    await expect(fake.connect({ phone: '+1' }, host)).rejects.toThrow('wrong code')
    await expect(fake.connect({ phone: '+1' }, host)).resolves.toBeTruthy()
    expect(asked).toEqual(['code', 'code'])
  })

  test('shows a QR code until it is paired, then takes it away', async () => {
    const fake = fakeProvider({ signIn: 'qr' })
    const shown: unknown[] = []
    const linking = fake.connect(
      {},
      hostWith({ show: (screen) => shown.push(screen?.kind ?? null) }),
    )
    await Promise.resolve()
    expect(shown).toEqual(['qr'])
    fake.world.pair()
    await linking
    expect(shown).toEqual(['qr', null])
  })
})
