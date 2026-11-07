// @vitest-environment jsdom
import { fakeProvider } from '@orden/chats/fake-provider'
import type { Host } from '@orden/chats/provider'
import { secretName } from '@orden/chats/provider'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Accounts } from './accounts.svelte'
import { Connected } from './connected.svelte'
import { signal } from './providers/signal'

const KEY = 'orden:chat-accounts'
const vault = new Map<string, string>()

function spiedHost() {
  const socket = vi.fn(() => Promise.reject(new Error('no socket here')))
  const wire = vi.fn(() => Promise.reject(new Error('no wire here')))
  const sidecar = vi.fn(() => Promise.reject(new Error('no sidecar here')))
  const fetch = vi.fn(() => Promise.reject(new Error('no network here')))
  const host: Host = {
    secret: (name) => Promise.resolve(vault.get(name) ?? null),
    keepSecret: (name, value) => {
      if (value === null) vault.delete(name)
      else vault.set(name, value)
      return Promise.resolve()
    },
    socket,
    wire,
    sidecar,
    fetch,
    now: () => 0,
  }
  return { host, socket, wire, sidecar, fetch }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vault.clear()
  localStorage.clear()
})

describe('connected services while Chats is off', () => {
  test('nothing connects, relinks, opens a socket or starts a sidecar, and what is kept stays', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { provider: 'fake', account: 'Work', config: { name: 'Work' } },
        { provider: 'signal', account: '+41790000001', config: {} },
      ]),
    )
    vault.set(secretName('signal', '+41790000001', 'session'), 'kept')
    const fake = fakeProvider()
    const connect = vi.spyOn(fake, 'connect')
    const signalConnect = vi.spyOn(signal, 'connect')
    const spied = spiedHost()
    const hub = new Connected()
    const accounts = new Accounts(spied.host, hub, [fake, signal], () => false)

    accounts.start()
    await accounts.relink({ provider: 'fake', account: 'Work', config: { name: 'Work' } })
    await accounts.relink({ provider: 'signal', account: '+41790000001', config: {} })
    expect(await accounts.connect('fake', { name: 'New' })).toBe('chats are off')
    await settle()

    expect(connect).not.toHaveBeenCalled()
    expect(signalConnect).not.toHaveBeenCalled()
    expect(spied.socket).not.toHaveBeenCalled()
    expect(spied.wire).not.toHaveBeenCalled()
    expect(spied.sidecar).not.toHaveBeenCalled()
    expect(spied.fetch).not.toHaveBeenCalled()
    expect(hub.linked).toEqual([])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toHaveLength(2)
    expect(vault.get(secretName('signal', '+41790000001', 'session'))).toBe('kept')
    signalConnect.mockRestore()
  })

  test('turned on, the kept accounts link again; turned off, they stop and stay kept', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ provider: 'fake', account: 'Work', config: { name: 'Work' } }]),
    )
    let on = false
    const fake = fakeProvider()
    const connect = vi.spyOn(fake, 'connect')
    const hub = new Connected()
    const accounts = new Accounts(spiedHost().host, hub, [fake], () => on)

    accounts.start()
    await settle()
    expect(connect).not.toHaveBeenCalled()

    on = true
    accounts.start()
    await settle()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(hub.find('fake', 'Work')).toBeDefined()
    const connection = fake.connection
    if (!connection) throw new Error('no connection')
    const close = vi.spyOn(connection, 'close')

    on = false
    await accounts.stop()
    expect(close).toHaveBeenCalledTimes(1)
    expect(hub.linked).toEqual([])
    expect(accounts.saved).toEqual([
      { provider: 'fake', account: 'Work', config: { name: 'Work' } },
    ])
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toHaveLength(1)

    on = true
    accounts.start()
    await settle()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(hub.find('fake', 'Work')).toBeDefined()
  })

  test('a link that lands after Chats was turned off is let go at once', async () => {
    let on = true
    const fake = fakeProvider()
    const hub = new Connected()
    const accounts = new Accounts(spiedHost().host, hub, [fake], () => on)
    const linking = accounts.relink({ provider: 'fake', account: 'Work', config: { name: 'Work' } })
    on = false
    await linking
    await settle()
    expect(hub.linked).toEqual([])
  })
})
