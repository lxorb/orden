import { blank } from '@orden/pass/envelope'
import type { Content, Envelope, Item, Login, Vault } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import app from '../src'
import { signIn, type TestEnv, testEnv } from './harness'

const FAST = { m: 64, t: 1, p: 1 }
const PASSWORD = 'correct horse battery staple'

interface Rows {
  keyringRow: { keyring: { pub: string }; rev: number; pending: boolean } | null
  itemRows: Map<string, { vault: string; id: string; pending: boolean; deleted: boolean }>
  versionRows: { id: string; rev: number; key: string; body: string }[]
  vaults(): Promise<unknown[]>
  items(): Promise<unknown[]>
  write(change: unknown): Promise<void>
  writeKeyring(row: unknown): Promise<void>
}

interface Device {
  rows: Rows
  items: Item[]
  vaults: Vault[]
  conflict: boolean
  world(api: unknown, account: string, email: string): unknown
  setup(password: string, name?: string): Promise<string>
  makeVault(name: string): Promise<string>
  unlock(password: string): Promise<boolean>
  lock(): void
  create(vault: string, content: Content): Promise<string>
  change(id: string, next: (envelope: Envelope) => Envelope): Promise<void>
  remove(id: string): Promise<void>
  move(id: string, vault: string): Promise<void>
  item(id: string): Item
  vaultNamed(name: string): Vault
  pending(): unknown[]
}

interface Kit {
  TestDevice: new (kdf: typeof FAST) => Device
  PassApi: new (call: unknown, from?: () => string | null) => unknown
  fetchCall(fetcher: (request: Request) => Promise<Response>, base: string, token: string): unknown
  syncOnce(world: unknown): Promise<string>
  adoptedChange(
    before: { vaults: unknown[]; items: unknown[] },
    items: Item[],
    vaults: Vault[],
    account: unknown,
    name: string,
  ): Promise<unknown>
  accountKeyringOf(rows: Rows): Promise<{ keyring: never; rev: number } | null>
  keepAdopted(rows: Rows, rev: number): Promise<void>
  openWithPassword(keyring: never, password: string): Promise<unknown>
  openVersion(
    key: Uint8Array<ArrayBuffer>,
    vault: string,
    id: string,
    rev: number,
    sealed: string,
    body: string,
  ): Promise<unknown>
}

async function kit(): Promise<Kit> {
  const at = (file: string) => new URL(`../../../${file}`, import.meta.url).href
  const loaded = await Promise.all(
    [
      ...['test-device', 'sync', 'exchange', 'adopt', 'synced'].map(
        (file) => `apps/desktop/src/lib/pass-sync/src/${file}.ts`,
      ),
      'packages/pass/src/keys.ts',
    ].map((file) => import(/* @vite-ignore */ at(file)) as Promise<object>),
  )
  return Object.assign({}, ...loaded) as Kit
}

let env: TestEnv
let k: Kit
let token: string
let account: string

const EMAIL = 'ada@example.com'

beforeEach(async () => {
  env = testEnv()
  k = await kit()
  token = await signIn(env, EMAIL)
  account = (env.db.prepare('select id from users where email = ?').get(EMAIL) as { id: string }).id
})

afterEach(() => env.close())

function worker(request: Request): Promise<Response> {
  return Promise.resolve(app.fetch(request, env))
}

function oldServer(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/v2/pass')) {
    return Promise.resolve(new Response('404 Not Found', { status: 404 }))
  }
  return worker(request)
}

function synced(device: Device, fetcher = worker): Promise<string> {
  const api = new k.PassApi(k.fetchCall(fetcher, 'https://nibeditor.com', token))
  return k.syncOnce(device.world(api, account, EMAIL))
}

function login(title: string, more: Partial<Login> = {}): Login {
  return { ...blank('login'), title, ...more }
}

const content = (device: Device, id: string) => device.item(id).content as Login

async function twoDevices(): Promise<{ a: Device; b: Device; id: string }> {
  const a = new k.TestDevice(FAST)
  const personal = await a.setup(PASSWORD)
  const id = await a.create(personal, login('Bank', { username: 'ada', password: 'one' }))
  expect(await synced(a)).toBe('synced')
  const b = new k.TestDevice(FAST)
  expect(await synced(b)).toBe('synced')
  expect(await b.unlock(PASSWORD)).toBe(true)
  expect(await synced(b)).toBe('synced')
  return { a, b, id }
}

describe('Pass on two devices of one account', () => {
  test('sends what the first device holds and opens it on the second with the password', async () => {
    const a = new k.TestDevice(FAST)
    const personal = await a.setup(PASSWORD)
    const id = await a.create(personal, login('Bank', { password: 'hunter2' }))
    expect(await synced(a)).toBe('synced')
    expect(a.pending()).toEqual([])
    expect(a.rows.keyringRow?.pending).toBe(false)

    const b = new k.TestDevice(FAST)
    expect(await synced(b)).toBe('synced')
    expect(b.rows.keyringRow?.keyring.pub).toBe(a.rows.keyringRow?.keyring.pub)
    expect(b.items).toEqual([])
    expect(await b.unlock('wrong')).toBe(false)
    expect(await b.unlock(PASSWORD)).toBe(true)
    expect(b.items).toEqual([])
    expect(await synced(b)).toBe('synced')
    expect(content(b, id)).toMatchObject({ title: 'Bank', password: 'hunter2' })
    expect(b.vaults.map((one) => one.name)).toEqual(['Personal'])
  })

  test('meets two edits of different fields in one item', async () => {
    const { a, b, id } = await twoDevices()
    await b.change(id, (one) => ({
      ...one,
      content: { ...one.content, password: 'two' } as Login,
      modified: 100,
    }))
    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, note: 'from a' },
      modified: 200,
    }))
    expect(await synced(b)).toBe('synced')
    expect(await synced(a)).toBe('synced')
    expect(content(a, id)).toMatchObject({ password: 'two', note: 'from a' })
    expect(a.pending()).toEqual([])
    expect(await synced(b)).toBe('synced')
    expect(content(b, id)).toMatchObject({ password: 'two', note: 'from a' })
  })

  test('gives one field to the newer edit and keeps the other as a version', async () => {
    const { a, b, id } = await twoDevices()
    await b.change(id, (one) => ({
      ...one,
      content: { ...one.content, password: 'from b' } as Login,
      modified: 300,
    }))
    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, password: 'from a' } as Login,
      modified: 200,
    }))
    expect(await synced(b)).toBe('synced')
    expect(await synced(a)).toBe('synced')
    expect(content(a, id).password).toBe('from b')
    expect(a.rows.versionRows.some((one) => one.id === id)).toBe(true)
  })

  test('takes a deletion from the other device', async () => {
    const { a, b, id } = await twoDevices()
    await b.remove(id)
    expect(await synced(b)).toBe('synced')
    expect(await synced(a)).toBe('synced')
    expect(a.items).toEqual([])
    expect([...a.rows.itemRows.values()].every((one) => one.deleted && !one.pending)).toBe(true)
  })

  test('keeps the last copy of an item deleted on the other device for 30 days', async () => {
    const { a, b, id } = await twoDevices()
    await b.remove(id)
    expect(await synced(b)).toBe('synced')
    expect(await synced(a)).toBe('synced')
    const kept = a.rows.versionRows.filter((one) => one.id === id)
    expect(kept).toHaveLength(1)
    const vault = a.vaultNamed('Personal')
    const box = (
      a as unknown as { held: { vaults: Map<string, { key: Uint8Array<ArrayBuffer> }> } }
    ).held.vaults.get(vault.id)!
    const opened = (await k.openVersion(
      box.key,
      vault.id,
      id,
      kept[0]!.rev,
      kept[0]!.key,
      kept[0]!.body,
    )) as {
      envelope: { content: Login }
    }
    expect(opened.envelope.content.password).toBe('one')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 31 * 24 * 3600e3)
    await a.create(vault.id, login('Later'))
    expect(await synced(a)).toBe('synced')
    vi.useRealTimers()
    expect(a.rows.versionRows.filter((one) => one.id === id)).toEqual([])
  })

  test('keeps an edit made while the other device deleted the item', async () => {
    const { a, b, id } = await twoDevices()
    await a.change(id, (one) => ({
      ...one,
      content: { ...one.content, note: 'kept' },
      modified: 500,
    }))
    expect(await synced(a)).toBe('synced')
    await b.remove(id)
    expect(await synced(b)).toBe('synced')
    expect(content(b, id).note).toBe('kept')
  })

  test('moves an item into another vault', async () => {
    const { a, b, id } = await twoDevices()
    const work = await a.makeVault('Work')
    await a.move(id, work)
    expect(await synced(a)).toBe('synced')
    expect(a.pending()).toEqual([])
    expect(await synced(b)).toBe('synced')
    expect(b.item(id).vault).toBe(work)
    expect(b.vaultNamed('Work').id).toBe(work)
    expect(b.items).toHaveLength(1)
  })

  test('takes what arrived while locked when it next opens', async () => {
    const { a, b, id } = await twoDevices()
    b.lock()
    await a.change(id, (one) => ({ ...one, pinned: true, modified: 900 }))
    expect(await synced(a)).toBe('synced')
    expect(await synced(b)).toBe('synced')
    expect(await b.unlock(PASSWORD)).toBe(true)
    expect(b.item(id).pinned).toBe(true)
  })

  test('sends and takes nothing from an account without Pass, and loses nothing', async () => {
    const a = new k.TestDevice(FAST)
    const personal = await a.setup(PASSWORD)
    await a.create(personal, login('Bank'))
    expect(await synced(a, oldServer)).toBe('old-server')
    expect(a.pending()).toHaveLength(1)
    expect(a.rows.keyringRow?.pending).toBe(true)
    expect(a.items).toHaveLength(1)
    expect(await synced(a)).toBe('synced')
    expect(a.pending()).toEqual([])
  })

  test('asks before it meets a Pass made on this device with the account’s, then folds it in', async () => {
    const { a } = await twoDevices()
    const c = new k.TestDevice(FAST)
    const own = await c.setup('another password')
    const mine = await c.create(own, login('Mail', { password: 'local' }))
    expect(await synced(c)).toBe('conflict')
    expect(c.conflict).toBe(true)
    expect(c.pending()).toHaveLength(1)

    const theirs = await k.accountKeyringOf(c.rows)
    if (!theirs) throw new Error('the account keyring was not kept')
    const opened = await k.openWithPassword(theirs.keyring, PASSWORD)
    const before = { vaults: await c.rows.vaults(), items: await c.rows.items() }
    await c.rows.write(await k.adoptedChange(before, c.items, c.vaults, opened, 'From this device'))
    await c.rows.writeKeyring({ keyring: theirs.keyring, rev: theirs.rev, pending: false })
    await k.keepAdopted(c.rows, theirs.rev)
    c.lock()
    expect(await c.unlock(PASSWORD)).toBe(true)
    expect(await synced(c)).toBe('synced')
    expect(c.vaults.map((one) => one.name).sort()).toEqual(['From this device', 'Personal'])
    expect(c.items.map((one) => one.content.title).sort()).toEqual(['Bank', 'Mail'])

    expect(await synced(a)).toBe('synced')
    expect(content(a, mine)).toMatchObject({ title: 'Mail', password: 'local' })
    expect(a.item(mine).vault).toBe(a.vaultNamed('From this device').id)
  })

  test('does not hand one account’s Pass to another', async () => {
    const { a } = await twoDevices()
    const other = await signIn(env, 'bob@example.com')
    const api = new k.PassApi(k.fetchCall(worker, 'https://nibeditor.com', other))
    expect(await k.syncOnce(a.world(api, 'someone-else', 'bob@example.com'))).toBe('other-account')
  })
})
