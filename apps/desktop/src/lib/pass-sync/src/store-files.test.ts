import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import { FILE_PART } from '@orden/pass/files'
import type { Alias } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NotHere } from './attachments'
import { deviceRows } from './device-rows'
import type { FileApi } from './file-api'
import { waitingFiles } from './file-queue'
import { forgetLocal, readFileParts, readMeta } from './local'
import { configurePass, PassStore } from './store.svelte'

vi.mock('../../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

beforeEach(async () => {
  await forgetLocal()
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
    removeItem: (key: string) => kept.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function opened(): Promise<{ store: PassStore; vault: string }> {
  const store = new PassStore()
  store.fileSource = () => Promise.resolve(null)
  await store.start()
  await store.setup('correct horse battery staple')
  return { store, vault: store.vaults[0]?.id ?? '' }
}

const picked = (bytes: Uint8Array, name = 'scan.pdf') => ({
  name,
  type: 'application/pdf',
  bytes,
})

describe('a file attached to an item', () => {
  test('is sealed on this device, listed on the item and opened again', async () => {
    const { store, vault } = await opened()
    const item = await store.create(vault, { ...blank('note'), title: 'Passport' })
    const bytes = new Uint8Array([1, 2, 3, 4])
    const after = await store.attach(item.id, picked(bytes))
    const [attachment] = after.attachments
    expect(attachment).toMatchObject({ name: 'scan.pdf', type: 'application/pdf', size: 4 })
    if (!attachment) throw new Error('no attachment')
    expect(await store.fileBytes(item.id, attachment.id)).toEqual(bytes)
    const parts = await readFileParts(item.id, attachment.id)
    expect(parts).toHaveLength(1)
    expect(parts[0]?.bytes).not.toEqual(bytes)
    expect(await waitingFiles(deviceRows)).toEqual([
      { item: item.id, file: attachment.id, parts: 1, gone: null },
    ])
  })

  test('over 4 MiB is kept in parts', async () => {
    const { store, vault } = await opened()
    const item = await store.create(vault, { ...blank('note'), title: 'Scan' })
    const bytes = new Uint8Array(FILE_PART + 3).fill(9)
    const after = await store.attach(item.id, picked(bytes))
    const id = after.attachments[0]?.id ?? ''
    expect(await readFileParts(item.id, id)).toHaveLength(2)
    const back = await store.fileBytes(item.id, id)
    expect(back.length).toBe(bytes.length)
    expect(back.every((one) => one === 9)).toBe(true)
  })

  test('taken off is forgotten here, and never sent', async () => {
    const { store, vault } = await opened()
    const item = await store.create(vault, { ...blank('note'), title: 'Deed' })
    const after = await store.attach(item.id, picked(new Uint8Array([5])))
    const id = after.attachments[0]?.id ?? ''
    const left = await store.detach(item.id, id)
    expect(left.attachments).toEqual([])
    expect(await readFileParts(item.id, id)).toEqual([])
    expect(await waitingFiles(deviceRows)).toEqual([])
  })

  test('still opens after its item moves to another vault and gets a new key', async () => {
    const { store, vault } = await opened()
    const other = await store.createVault({ name: 'Work' })
    const item = await store.create(vault, { ...blank('note'), title: 'Contract' })
    const after = await store.attach(item.id, picked(new Uint8Array([7, 7])))
    const id = after.attachments[0]?.id ?? ''
    const key = after.attachments[0]?.key
    await store.move([item.id], other.id)
    const moved = store.items.find((one) => one.id === item.id)
    expect(moved?.vault).toBe(other.id)
    expect(moved?.attachments[0]?.key).not.toBe(key)
    expect(await store.fileBytes(item.id, id)).toEqual(new Uint8Array([7, 7]))
  })

  test('goes from this device with its item', async () => {
    const { store, vault } = await opened()
    const item = await store.create(vault, { ...blank('note'), title: 'Old' })
    const after = await store.attach(item.id, picked(new Uint8Array([1])))
    const id = after.attachments[0]?.id ?? ''
    await store.remove([item.id])
    expect(await readFileParts(item.id, id)).toEqual([])
    expect(await waitingFiles(deviceRows)).toEqual([])
  })

  test('not on this device is fetched from the account, and kept', async () => {
    const { store, vault } = await opened()
    const item = await store.create(vault, { ...blank('note'), title: 'Far' })
    const after = await store.attach(item.id, picked(new Uint8Array([3, 1, 4])))
    const id = after.attachments[0]?.id ?? ''
    const parts = await readFileParts(item.id, id)
    const { dropFileParts } = await import('./local')
    await dropFileParts(item.id, id)
    await expect(store.fileBytes(item.id, id)).rejects.toBeInstanceOf(NotHere)
    const asked: string[] = []
    const remote: FileApi = {
      put: () => Promise.reject(new Error('no')),
      get: (at, it, file, part) => {
        asked.push(`${at}/${it}/${file}/${String(part)}`)
        const bytes = parts[part]?.bytes
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('none'))
      },
      remove: () => Promise.resolve(),
    }
    store.fileSource = () => Promise.resolve(remote)
    expect(await store.fileBytes(item.id, id)).toEqual(new Uint8Array([3, 1, 4]))
    expect(asked).toEqual([`${vault}/${item.id}/${id}/0`])
    expect(await readFileParts(item.id, id)).toHaveLength(1)
  })
})

describe('the alias service', () => {
  test('is kept sealed, read back and forgotten', async () => {
    const { store } = await opened()
    expect(await store.aliasProvider()).toBeNull()
    await store.setAliasProvider({
      provider: 'addy',
      key: ' secret-alias-key ',
      mailbox: 'r1',
      suffix: null,
    })
    expect(await store.aliasProvider()).toEqual({
      provider: 'addy',
      key: 'secret-alias-key',
      mailbox: 'r1',
      suffix: null,
    })
    expect(JSON.stringify(await readMeta('alias'))).not.toContain('secret-alias-key')
    await store.setAliasProvider(null)
    expect(await store.aliasProvider()).toBeNull()
  })

  test('turns off an alias moved to the trash', async () => {
    const { store, vault } = await opened()
    await store.setAliasProvider({ provider: 'addy', key: 'k', mailbox: null, suffix: null })
    const calls: string[] = []
    vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${input}`)
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    const alias: Alias = {
      ...blank('alias'),
      title: 'Shop',
      address: 'shop@anonaddy.me',
      provider: 'addy',
      remoteId: 'abc',
      enabled: true,
    }
    const made = await store.create(vault, alias)
    await store.trash([made.id])
    await store.aliasesStopped
    expect(calls).toEqual(['DELETE https://app.addy.io/api/v1/active-aliases/abc'])
    const after = store.items.find((one) => one.id === made.id)
    expect(after?.trashed).not.toBeNull()
    expect(after?.content.kind === 'alias' && after.content.enabled).toBe(false)
  })

  test('leaves an alias of its own alone in the trash', async () => {
    const { store, vault } = await opened()
    const fetching = vi.fn()
    vi.stubGlobal('fetch', fetching)
    const made = await store.create(vault, { ...blank('alias'), title: 'Mine', enabled: true })
    await store.trash([made.id])
    await store.aliasesStopped
    expect(fetching).not.toHaveBeenCalled()
  })
})
