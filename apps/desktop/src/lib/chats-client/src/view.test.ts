import { ulid, type Who } from '@orden/chats'
import { afterEach, describe, expect, test } from 'vitest'
import { MemoryCache } from './cache'
import { ChatEngine } from './engine'
import { Account, CHAT, random } from './test-account'
import { type Host, View } from './view.svelte'

const ME: Who = 'user:ana'
const stops: (() => void)[] = []

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

async function opened(account: Account, readSeq = 0, cache = new MemoryCache()) {
  const engine = new ChatEngine(
    cache,
    account.remote(ME, () => true),
    () => ME,
  )
  stops.push(() => engine.stop())
  await engine.refresh()
  await engine.sync(CHAT)
  const host: Host = {
    engine,
    cache,
    me: () => ME,
    entry: () => null,
    token: () => null,
    device: () => Promise.resolve(null),
    members: () => Promise.resolve([]),
    receipts: () => true,
    profile: () => undefined,
    release: () => true,
  }
  const view = new View(CHAT, host)
  view.lineAt = readSeq
  stops.push(() => view.close())
  await view.open()
  return { view, engine }
}

class SlowCache extends MemoryCache {
  gate: Promise<void> | null = null

  override async window(ask: Parameters<MemoryCache['window']>[0]) {
    const rows = await super.window(ask)
    await this.gate
    return rows
  }
}

function said(account: Account, count: number, who: Who = 'user:ben') {
  const next = random(count)
  for (let at = 0; at < count; at++) {
    const id = ulid(1000 + at, next)
    account.place(who, { kind: 'post', id, message: `m${id}`, body: `line ${String(at)}` })
  }
}

describe('a chat’s window', () => {
  test('opens at the newest, and pages back to the first message', async () => {
    const account = new Account()
    said(account, 450)
    const { view } = await opened(account)
    expect(view.messages).toHaveLength(100)
    expect(view.messages.at(-1)?.body).toBe('line 449')
    expect(view.atEnd).toBe(true)

    await view.older()
    await view.older()
    expect(view.messages).toHaveLength(450)
    expect(view.messages[0]?.body).toBe('line 0')
    expect(view.atStart).toBe(true)
  })

  test('opens around the read place', async () => {
    const account = new Account()
    said(account, 300)
    const { view } = await opened(account, 120)
    const seqs = view.messages.map((one) => one.seq)
    expect(seqs).toContain(121)
    expect(view.atEnd).toBe(false)
    await view.newer()
    expect(view.messages.at(-1)?.seq).toBe(300)
  })

  test('keeps a message that came while it was opening', async () => {
    const account = new Account()
    said(account, 3)
    const cache = new SlowCache()
    const { view, engine } = await opened(account, 0, cache)
    let open: () => void = () => undefined
    cache.gate = new Promise((done) => (open = done))

    const reopening = view.latest()
    said(account, 1, 'user:cleo')
    await engine.sync(CHAT)
    open()
    await reopening

    expect(view.messages).toHaveLength(4)
    expect(view.messages.at(-1)?.author).toBe('user:cleo')
  })

  test('draws a post at once and keeps it through its placing', async () => {
    const account = new Account()
    said(account, 3)
    const { view, engine } = await opened(account)
    const drawn: number[] = []
    stops.push(view.watch(() => drawn.push(view.pending.length + view.messages.length)))

    await engine.queue(CHAT, { kind: 'post', id: 'e1', message: 'mine', body: 'hello' })
    await engine.flush(CHAT)
    await engine.sync(CHAT)
    expect(view.pending).toEqual([])
    expect(view.messages.at(-1)).toMatchObject({ id: 'mine', body: 'hello', sending: false })
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(3)
  })

  test('keeps replies in their own list', async () => {
    const account = new Account()
    said(account, 2)
    const parent = account.log[0]
    if (parent?.kind !== 'post') throw new Error('a post first')
    account.place(ME, {
      kind: 'post',
      id: 'r1',
      message: 'reply',
      body: 'yes',
      parent: parent.message,
    })
    const { view } = await opened(account)
    expect(view.messages.map((one) => one.id)).not.toContain('reply')
    expect(view.messages[0]?.replies).toBe(1)

    const replies = view.replies(parent.message)
    await new Promise((done) => setTimeout(done, 0))
    expect(replies.messages.map((one) => one.id)).toEqual(['reply'])
    expect(replies.parent?.id).toBe(parent.message)
  })
})
