import type { Look } from '@orden/sync-core/look'
import { beforeEach, describe, expect, test } from 'vitest'
import { type AccountDouble, accountDouble } from '../account-double'
import { LookSync } from './look-sync'

const DARK_GLASS: Look = { theme: 'glass', scheme: 'dark', values: { '*': { accent: 'blue' } } }
const LIGHT_ROSE: Look = { theme: 'file:rose', scheme: 'light', values: {}, css: ':root{}' }
const CLASSIC: Look = { theme: 'default', scheme: 'system', values: {} }

interface Server {
  settings: Map<string, Record<string, unknown>>
  devices: Set<Device>
  away: boolean
  held: Promise<void> | null
}

let server: Server

interface Device {
  account: AccountDouble
  sync: LookSync
  worn: Look
  pick(look: Look): void
  hear(): void
  settle(): Promise<void>
}

function userOf(token: string): string {
  return token.replace(/^token-/, '')
}

function device(start: Look, user: string | null = 'a'): Device {
  const account = accountDouble(user)
  const pending: Promise<unknown>[] = []
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.push(work)
    return work
  }

  const one: Device = {
    account,
    worn: start,
    sync: new LookSync({
      token: () => account.accountToken,
      look: () => one.worn,
      wear: (look) => {
        one.worn = look
        return Promise.resolve()
      },
      read: async (token) => {
        await server.held
        if (server.away) throw new Error('offline')
        return { ...server.settings.get(userOf(token)) }
      },
      save: async (token, look) => {
        if (server.away) throw new Error('offline')
        const who = userOf(token)
        server.settings.set(who, { ...server.settings.get(who), look })
        for (const other of server.devices) {
          if (other.account.accountToken === token) other.hear()
        }
      },
    }),
    pick: (look) => {
      one.worn = look
      one.sync.picked()
    },
    hear: () => {
      const token = account.accountToken
      if (token) void track(one.sync.adopt(token))
    },
    settle: async () => {
      while (pending.length) await pending.shift()
    },
  }
  account.forgetWithSession(() => one.sync.forget())
  server.devices.add(one)
  return one
}

function signIn(one: Device): Promise<void> {
  const token = one.account.accountToken
  return token ? one.sync.adopt(token) : Promise.resolve()
}

async function settled(...devices: Device[]) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (const one of devices) await one.settle()
}

beforeEach(() => {
  server = { settings: new Map(), devices: new Set(), away: false, held: null }
})

describe('a theme that follows the account', () => {
  test('picked on one device is worn on the other', async () => {
    const laptop = device(CLASSIC)
    const phone = device(CLASSIC)
    await signIn(laptop)
    await signIn(phone)

    laptop.pick(DARK_GLASS)
    await settled(laptop, phone)

    expect(phone.worn).toEqual(DARK_GLASS)
    expect(server.settings.get('a')?.look).toEqual(DARK_GLASS)
  })

  test('takes the account’s theme the first time a device syncs', async () => {
    server.settings.set('a', { look: DARK_GLASS })
    const fresh = device(LIGHT_ROSE)

    await signIn(fresh)

    expect(fresh.worn).toEqual(DARK_GLASS)
    expect(server.settings.get('a')?.look).toEqual(DARK_GLASS)
  })

  test('gives the account this device’s theme when the account has none yet', async () => {
    server.settings.set('a', { ligatures: true })
    const first = device(LIGHT_ROSE)

    await signIn(first)

    expect(first.worn).toEqual(LIGHT_ROSE)
    expect(server.settings.get('a')).toEqual({ ligatures: true, look: LIGHT_ROSE })
  })

  test('reads an account an older build wrote, with settings it does not know', async () => {
    server.settings.set('a', { look: { ...DARK_GLASS, someday: 1 }, vim: true })
    const one = device(CLASSIC)

    await signIn(one)

    expect(one.worn).toEqual(DARK_GLASS)
  })

  test('keeps a theme picked while signed out on this device only', async () => {
    server.settings.set('a', { look: DARK_GLASS })
    const one = device(CLASSIC, null)

    one.pick(LIGHT_ROSE)
    one.account.signInAs('a')
    await signIn(one)

    expect(one.worn).toEqual(DARK_GLASS)
    expect(server.settings.get('a')?.look).toEqual(DARK_GLASS)
  })

  test('keeps the last theme on the device after signing out', async () => {
    server.settings.set('a', { look: DARK_GLASS })
    const one = device(CLASSIC)
    await signIn(one)

    one.account.signOut()

    expect(one.worn).toEqual(DARK_GLASS)
    one.pick(LIGHT_ROSE)
    expect(server.settings.get('a')?.look).toEqual(DARK_GLASS)
  })

  test('sends a pick that could not be sent before reading the account again', async () => {
    const laptop = device(CLASSIC)
    await signIn(laptop)
    server.away = true
    laptop.pick(DARK_GLASS)
    await settled(laptop)
    server.away = false

    await signIn(laptop)

    expect(laptop.worn).toEqual(DARK_GLASS)
    expect(server.settings.get('a')?.look).toEqual(DARK_GLASS)
  })

  test('never carries a pick owed to one account into the next', async () => {
    server.settings.set('b', { look: CLASSIC })
    const one = device(CLASSIC)
    await signIn(one)
    server.away = true
    one.pick(DARK_GLASS)
    await settled(one)
    server.away = false

    one.account.signInAs('b')
    await signIn(one)

    expect(server.settings.get('b')?.look).toEqual(CLASSIC)
    expect(server.settings.get('a')?.look).toEqual(CLASSIC)
    expect(one.worn).toEqual(CLASSIC)
  })

  test('never wears what one account answered after switching to another', async () => {
    server.settings.set('a', { look: DARK_GLASS })
    server.settings.set('b', { look: LIGHT_ROSE })
    const one = device(CLASSIC)
    let free: () => void = () => undefined
    server.held = new Promise((resolve) => (free = resolve))
    const reading = signIn(one)

    one.account.signInAs('b')
    const next = signIn(one)
    free()
    await Promise.all([reading, next])

    expect(one.worn).toEqual(LIGHT_ROSE)
  })

  test('a pick made while the account is being read wins over the answer', async () => {
    server.settings.set('a', { look: DARK_GLASS })
    const one = device(CLASSIC)
    let free: () => void = () => undefined
    server.held = new Promise((resolve) => (free = resolve))
    const reading = signIn(one)

    server.held = null
    one.pick(LIGHT_ROSE)
    free()
    await reading
    await settled(one)

    expect(one.worn).toEqual(LIGHT_ROSE)
    expect(server.settings.get('a')?.look).toEqual(LIGHT_ROSE)
  })
})
