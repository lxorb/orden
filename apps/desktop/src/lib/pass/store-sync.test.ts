import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import { newKeyring } from '@orden/pass/keys'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { deviceRows } from './device-rows'
import { forgetLocal, readItems, readKeyring } from './local'
import { nothingShown } from './shown'
import { configurePass, PassStore } from './store.svelte'
import { accountKeyringOf, cursorOf, keepAccountKeyring, keepCursor } from './synced'

const fake = vi.hoisted(() => ({ secrets: new Map<string, string>() }))

vi.mock('../ai/keys', () => ({
  keysAreGuarded: () => true,
  readSecret: (id: string) => Promise.resolve(fake.secrets.get(id) ?? null),
  writeSecret: (id: string, secret: string) => {
    fake.secrets.set(id, secret)
    return Promise.resolve()
  },
  forgetKey: (id: string) => {
    fake.secrets.delete(id)
    return Promise.resolve()
  },
}))

vi.mock('../protect/device', () => ({
  deviceCan: () => Promise.resolve(true),
  deviceSays: () => Promise.resolve(true),
  deviceName: () => 'Touch ID',
}))

const FAST = { m: 64, t: 1, p: 1 }
const MINE = 'the password on this device'
const ACCOUNT = 'the password of the account'

configurePass({ kdf: FAST, pinKdf: FAST })

async function opened(): Promise<PassStore> {
  const store = new PassStore()
  await store.start()
  await store.setup(MINE)
  return store
}

beforeEach(async () => {
  await forgetLocal()
  fake.secrets.clear()
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
    removeItem: (key: string) => kept.delete(key),
  })
})

describe('the store under sync', () => {
  test('tells its listeners after a change of its own, and not after one sync made', async () => {
    const store = await opened()
    const heard = vi.fn()
    store.onLocalChange(heard)
    await store.create(store.vaults[0]?.id ?? '', { ...blank('login'), title: 'Bank' })
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    await store.exclusive(() => Promise.resolve())
    await Promise.resolve()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  test('lends its keys to sync only while open', async () => {
    const store = await opened()
    expect(await store.exclusive((held) => Promise.resolve(held !== null))).toBe(true)
    store.lock()
    expect(await store.exclusive((held) => Promise.resolve(held !== null))).toBe(false)
  })

  test('shows what sync opened, and nothing while locked', async () => {
    const store = await opened()
    const item = await store.create(store.vaults[0]?.id ?? '', { ...blank('login'), title: 'A' })
    store.shown({
      ...nothingShown(),
      items: [{ ...item, content: { ...item.content, title: 'B' } }],
    })
    expect(store.items.map((one) => one.content.title)).toEqual(['B'])
    store.shown({ ...nothingShown(), goneItems: [{ vault: item.vault, id: item.id }] })
    expect(store.items).toEqual([])
    store.lock()
    store.shown({ ...nothingShown(), items: [item] })
    expect(store.items).toEqual([])
  })

  test('a keyring taken from the account makes a new device ask for the password', async () => {
    const store = new PassStore()
    await store.start()
    expect(store.state).toBe('new')
    const made = await newKeyring(ACCOUNT, FAST)
    store.tookKeyring({ keyring: made.keyring, rev: 1, pending: false })
    expect(store.state).toBe('locked')
  })

  test('folds this device’s Pass into the account’s with the account’s password', async () => {
    const store = await opened()
    const item = await store.create(store.vaults[0]?.id ?? '', {
      ...blank('login'),
      title: 'Mail',
      password: 'local',
    })
    await store.setHibpKey('hibp-key')
    await store.useLock('device')
    const account = await newKeyring(ACCOUNT, FAST)
    await keepAccountKeyring(deviceRows, { keyring: account.keyring, rev: 3 })
    await keepCursor(deviceRows, { account: 'ada', seq: 0 })
    store.conflict = true

    expect(await store.adoptAccountPass('wrong')).toBe(false)
    expect(store.conflict).toBe(true)
    expect(await store.adoptAccountPass(ACCOUNT)).toBe(true)

    expect(store.conflict).toBe(false)
    expect(store.state).toBe('open')
    expect(store.vaults.map((one) => one.name)).toEqual(['From this device'])
    expect(store.items.map((one) => [one.id, one.content.title])).toEqual([[item.id, 'Mail']])
    expect(await store.hibpKey()).toBe('hibp-key')
    expect(store.settings.lock).toBe('password')
    expect((await readKeyring())?.keyring.pub).toBe(account.keyring.pub)
    expect(await accountKeyringOf(deviceRows)).toBeNull()
    expect(await cursorOf(deviceRows)).toBeNull()
    const pending = (await readItems()).filter((one) => one.pending)
    expect(pending.map((one) => one.id)).toEqual([item.id])

    store.lock()
    expect(await store.unlock({ password: MINE })).toBe(false)
    expect(await store.unlock({ password: ACCOUNT })).toBe(true)
    expect(store.items.map((one) => one.content.title)).toEqual(['Mail'])
  })

  test('folds a locked device in when its password is the same', async () => {
    const store = await opened()
    await store.create(store.vaults[0]?.id ?? '', { ...blank('login'), title: 'Mail' })
    store.lock()
    const account = await newKeyring(MINE, FAST)
    await keepAccountKeyring(deviceRows, { keyring: account.keyring, rev: 1 })
    expect(await store.adoptAccountPass(MINE)).toBe(true)
    expect(store.items.map((one) => one.content.title)).toEqual(['Mail'])
  })
})
