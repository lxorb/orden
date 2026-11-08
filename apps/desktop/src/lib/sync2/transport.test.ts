import { describe, expect, test } from 'vitest'
import { unframe } from '@orden/sync-core/wire'
import { testDevice } from './test-device'
import { readingOver, Refused, remoteFiles } from './transport'
import { parseQuery } from '@orden/scan/search/query'

const SPACE = 'space-1'

async function made(fetch: (request: Request) => Promise<Response>) {
  const files = { 'Plan.md': 'We ship on Monday.\n' }
  const device = await testDevice({ fetch, token: 'token-1', files })
  const core = device.engine.core
  await core.commit(core.addSpace(SPACE, device.root, 'owner'))
  await device.engine.created(`${device.root}/Plan.md`, false, 'We ship on Monday.\n')
  return device
}

describe('the engine over the network', () => {
  test.each([
    ['no network', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a busy account', () => Promise.resolve(new Response('', { status: 429 }))],
    ['a proxy that timed out', () => Promise.resolve(new Response('', { status: 408 }))],
    ['a failing account', () => Promise.resolve(new Response('', { status: 503 }))],
  ])('%s is no answer: the pass stops and the new note waits', async (_said, fetch) => {
    const device = await made(fetch)

    expect(await device.engine.pass(SPACE)).toEqual({
      pulled: 0,
      pushed: 0,
      finished: false,
      full: false,
    })
    expect(device.engine.waiting(SPACE)).toBe(true)
    expect(device.store.rows('log')).toEqual([])
    expect(device.disk.files.get(`${device.root}/Plan.md`)).toBe('We ship on Monday.\n')
  })

  test('a refusal is said and written in the log, never read as offline', async () => {
    const device = await made(() =>
      Promise.resolve(Response.json({ error: 'session ended' }, { status: 401 })),
    )

    const passing = device.engine.pass(SPACE)
    await expect(passing).rejects.toBeInstanceOf(Refused)
    await expect(passing).rejects.toMatchObject({ status: 401, message: 'session ended' })
    expect(device.store.rows('log')).toEqual([
      expect.objectContaining({ space: SPACE, failed: 'session ended' }),
    ])
  })

  test('a request names the session and the device and carries the framed body', async () => {
    const asked: Request[] = []
    const device = await made((request) => {
      asked.push(request)
      return Promise.resolve(new Response('', { status: 503 }))
    })
    await device.engine.pass(SPACE)

    const [ops] = asked
    expect(ops?.method).toBe('POST')
    expect(new URL(ops?.url ?? '').pathname).toBe(`/v2/spaces/${SPACE}/ops`)
    expect(ops?.headers.get('authorization')).toBe('Bearer token-1')
    expect(ops?.headers.get('x-nib-device')).toBe('one')
    expect(ops?.headers.get('content-type')).toBe('application/octet-stream')
    const body = unframe(new Uint8Array(await ops!.arrayBuffer())) as {
      ops: { t: string; name: string }[]
    }
    expect(body.ops).toEqual([expect.objectContaining({ t: 'create', name: 'Plan.md' })])
  })
})

describe('a file’s bytes over the network', () => {
  const over = (status: number) =>
    remoteFiles({
      base: 'https://sync.test',
      token: () => 'token-1',
      device: () => 'one',
      fetch: () => Promise.resolve(Response.json({ error: 'out of space' }, { status })),
    })

  test('an account with no room for them is an answer, not none', async () => {
    expect(await over(507).up('h', new Uint8Array([1]))).toBe('full')
    expect(await over(413).up('h', new Uint8Array([1]))).toBe(false)
    expect(await over(503).up('h', new Uint8Array([1]))).toBeNull()
    expect(await over(507).down('s', 'f')).toBeNull()
  })

  test('an account that cannot say which bytes it keeps says nothing', async () => {
    expect(await over(404).have?.(['h'])).toBeNull()
    expect(await over(503).have?.(['h'])).toBeNull()
  })
})

describe('what a browser asks about the notes it keeps no words of (#1126)', () => {
  const over = (answer: () => Promise<Response>) =>
    readingOver({
      base: 'https://account.test',
      token: () => 'token-1',
      device: () => 'Browser',
      fetch: answer,
    })
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  const request = { query: parseQuery('plan'), terms: [], limit: 10 }

  test('reads the answers', async () => {
    const items = [{ id: 'n1', refused: 'gone' }]
    expect(await over(() => json({ items })).index(SPACE, ['n1'])).toEqual(items)
    const page = { hits: [], loose: [], after: null }
    expect(await over(() => json(page)).search(SPACE, request)).toEqual(page)
  })

  test('an account with no such route is one from before them: missing', async () => {
    const router = () => Promise.resolve(new Response('404 Not Found', { status: 404 }))
    expect(await over(router).index(SPACE, ['n1'])).toBe('missing')
    expect(await over(router).search(SPACE, request)).toBe('missing')
  })

  test('a space it does not have, no network or a busy account is no answer', async () => {
    for (const answer of [
      () => json({ error: 'no such space' }, 404),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json({}, 503),
    ]) {
      expect(await over(answer).index(SPACE, ['n1'])).toBeNull()
      expect(await over(answer).search(SPACE, request)).toBeNull()
    }
  })
})
