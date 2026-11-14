import { blank } from '@orden/pass/envelope'
import type { Attachment, Envelope, Item, Note } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import app from '../src'
import { sweepLeftovers } from '../src/sync-server/src/leftovers'
import { signIn, type TestEnv, testEnv } from './harness'

const FAST = { m: 64, t: 1, p: 1 }
const PASSWORD = 'correct horse battery staple'
const EMAIL = 'ada@example.com'
const BASE = 'https://nibeditor.com'

interface Part {
  item: string
  file: string
  part: number
  parts: number
  bytes: Uint8Array<ArrayBuffer>
}

interface Rows {
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
}

interface Device {
  rows: Rows
  items: Item[]
  held: { items: Map<string, { key: Uint8Array<ArrayBuffer> }> } | null
  world(api: unknown, account: string, email: string): Record<string, unknown>
  setup(password: string, name?: string): Promise<string>
  makeVault(name: string): Promise<string>
  unlock(password: string): Promise<boolean>
  create(vault: string, content: Note): Promise<string>
  change(id: string, next: (envelope: Envelope) => Envelope): Promise<void>
  remove(id: string): Promise<void>
  item(id: string): Item
}

interface FileApi {
  get(vault: string, item: string, file: string, part: number): Promise<Uint8Array<ArrayBuffer>>
}

interface Kit {
  TestDevice: new (kdf: typeof FAST) => Device
  PassApi: new (call: unknown) => unknown
  fetchCall(fetcher: (request: Request) => Promise<Response>, base: string, token: string): unknown
  syncOnce(world: unknown): Promise<string>
  fileApi(
    base: string,
    token: string,
    fetcher: (input: string, init: RequestInit) => Promise<Response>,
  ): FileApi
  queuedUpload(rows: Rows, item: string, file: string, parts: number): Promise<void>
  queuedRemoval(rows: Rows, vault: string, item: string, file: string): Promise<void>
  waitingFiles(rows: Rows): Promise<unknown[]>
  sealFile(
    key: Uint8Array<ArrayBuffer>,
    item: string,
    file: string,
    bytes: Uint8Array,
  ): Promise<{ key: string; parts: Uint8Array<ArrayBuffer>[] }>
  openFile(
    key: Uint8Array<ArrayBuffer>,
    item: string,
    file: string,
    sealed: string,
    parts: Uint8Array[],
    size: number,
  ): Promise<Uint8Array<ArrayBuffer>>
  FILE_PART: number
}

async function kit(): Promise<Kit> {
  const at = (file: string) => new URL(`../../../${file}`, import.meta.url).href
  const loaded = await Promise.all(
    [
      ...['test-device', 'sync', 'exchange', 'file-api', 'file-queue'].map(
        (file) => `apps/desktop/src/lib/pass-sync/src/${file}.ts`,
      ),
      'packages/pass/src/files.ts',
    ].map((file) => import(/* @vite-ignore */ at(file)) as Promise<object>),
  )
  return Object.assign({}, ...loaded) as Kit
}

let env: TestEnv
let k: Kit
let token: string
let account: string

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

function withLength(init: RequestInit): RequestInit {
  if (!(init.body instanceof Uint8Array)) return init
  const headers = new Headers(init.headers)
  headers.set('content-length', String(init.body.byteLength))
  return { ...init, headers }
}

const fetched = (input: string, init: RequestInit) => worker(new Request(input, withLength(init)))

class Kept {
  readonly parts: Part[] = []
  of(item: string, file: string): Promise<Part[]> {
    return Promise.resolve(this.parts.filter((one) => one.item === item && one.file === file))
  }
}

function synced(device: Device, kept: Kept): Promise<string> {
  const api = new k.PassApi(k.fetchCall(worker, BASE, token))
  const world = {
    ...device.world(api, account, EMAIL),
    files: () =>
      Promise.resolve({
        api: k.fileApi(BASE, token, fetched),
        parts: (item: string, file: string) => kept.of(item, file),
        drop: () => Promise.resolve(),
      }),
  }
  return k.syncOnce(world)
}

async function attached(
  device: Device,
  kept: Kept,
  id: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  const key = device.held?.items.get(id)?.key
  if (!key) throw new Error('no item key')
  const file = crypto.randomUUID()
  const sealed = await k.sealFile(key, id, file, bytes)
  const parts = sealed.parts.length
  kept.parts.push(...sealed.parts.map((one, part) => ({ item: id, file, part, parts, bytes: one })))
  await k.queuedUpload(device.rows, id, file, parts)
  const attachment = {
    id: file,
    name: 'scan.pdf',
    type: 'application/pdf',
    size: bytes.length,
    key: sealed.key,
  }
  await device.change(id, (one) => ({ ...one, attachments: [...one.attachments, attachment] }))
  return attachment
}

async function downloaded(device: Device, id: string, attachment: Attachment): Promise<Uint8Array> {
  const item = device.item(id)
  const key = device.held?.items.get(id)?.key
  if (!key) throw new Error('no item key')
  const api = k.fileApi(BASE, token, fetched)
  const count = Math.max(1, Math.ceil(attachment.size / k.FILE_PART))
  const parts: Uint8Array[] = []
  for (let part = 0; part < count; part++) {
    parts.push(await api.get(item.vault, id, attachment.id, part))
  }
  return await k.openFile(key, id, attachment.id, attachment.key, parts, attachment.size)
}

const objects = () => env.keys().filter((key) => key.startsWith('pass/files/'))

describe('a file attached on one device', () => {
  test('reaches the account in its parts and opens on the other device', async () => {
    const a = new k.TestDevice(FAST)
    const keptA = new Kept()
    const personal = await a.setup(PASSWORD)
    const id = await a.create(personal, { ...blank('note'), title: 'Passport' })
    const bytes = new Uint8Array(k.FILE_PART + 100).fill(42)
    const attachment = await attached(a, keptA, id, bytes)
    expect(await synced(a, keptA)).toBe('synced')
    expect(await k.waitingFiles(a.rows)).toEqual([])
    expect(objects()).toHaveLength(2)

    const b = new k.TestDevice(FAST)
    expect(await synced(b, new Kept())).toBe('synced')
    expect(await b.unlock(PASSWORD)).toBe(true)
    expect(await synced(b, new Kept())).toBe('synced')
    expect(b.item(id).attachments).toEqual([attachment])
    const opened = await downloaded(b, id, attachment)
    expect(opened.length).toBe(bytes.length)
    expect(opened.every((one) => one === 42)).toBe(true)
  })

  test('goes in the same exchange as the new item it belongs to', async () => {
    const a = new k.TestDevice(FAST)
    const kept = new Kept()
    const personal = await a.setup(PASSWORD)
    const id = await a.create(personal, { ...blank('note'), title: 'Deed' })
    await attached(a, kept, id, new Uint8Array([1, 2, 3]))
    expect(await synced(a, kept)).toBe('synced')
    expect(objects()).toHaveLength(1)
  })

  test('is deleted on the account when it is taken off the item', async () => {
    const a = new k.TestDevice(FAST)
    const kept = new Kept()
    const personal = await a.setup(PASSWORD)
    const id = await a.create(personal, { ...blank('note'), title: 'Deed' })
    const attachment = await attached(a, kept, id, new Uint8Array([1, 2, 3]))
    await synced(a, kept)
    await k.queuedRemoval(a.rows, personal, id, attachment.id)
    await a.change(id, (one) => ({ ...one, attachments: [] }))
    expect(await synced(a, kept)).toBe('synced')
    expect(objects()).toEqual([])
    expect(await k.waitingFiles(a.rows)).toEqual([])
  })

  test('goes with its item', async () => {
    const a = new k.TestDevice(FAST)
    const kept = new Kept()
    const personal = await a.setup(PASSWORD)
    const id = await a.create(personal, { ...blank('note'), title: 'Deed' })
    await attached(a, kept, id, new Uint8Array([1, 2, 3]))
    await synced(a, kept)
    await a.remove(id)
    expect(await synced(a, kept)).toBe('synced')
    await sweepLeftovers(env)
    expect(objects()).toEqual([])
  })
})
