import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PULL_BYTES, type PullAnswer, type PullResponse } from '@orden/sync-core'
import * as Y from 'yjs'
import { ROOM_PATIENCE } from '../src/sync-server/src/rooms'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { framed, type FramedAnswer, live } from './sync2'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  live(env)
  token = await signIn(env, 'pull@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Pull' } })).json.space.id
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  return answer.json.note.id
}

async function prepare() {
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
}

const EMPTY = Y.encodeStateVector(new Y.Doc())

function asking(ids: readonly string[], part?: boolean) {
  return { docs: ids.map((id) => ({ id, epoch: 1, sv: EMPTY })), ...(part ? { part } : {}) }
}

async function pulled(ids: readonly string[], part?: boolean) {
  return await framed<PullResponse>(env, '/v2/docs/pull', token, asking(ids, part))
}

function updated(answer: FramedAnswer<PullResponse>): Extract<PullAnswer, { update: unknown }>[] {
  return answer.value.docs.filter((one) => 'update' in one)
}

async function frozen(id: string) {
  await env.NOTES.put(`spaces/${space}/${id}`, 'written since the epoch began\n')
  await env.NOTES.delete(`crdt/${id}`)
  const rooms = env.ROOMS
  if (!rooms) throw new Error('no rooms')
  env.ROOMS = {
    idFromName: (name: string) => rooms.idFromName(name),
    get: (named: DurableObjectId) =>
      String(named) === id
        ? { fetch: () => new Promise<never>(() => undefined) }
        : rooms.get(named),
  } as unknown as DurableObjectNamespace
}

async function inFakeTime<T>(work: Promise<T>): Promise<T> {
  const state = { done: false }
  const settled = work.finally(() => {
    state.done = true
  })
  const until = Date.now() + 20_000
  while (!state.done && Date.now() < until) {
    if (vi.getTimerCount() > 0) await vi.advanceTimersByTimeAsync(ROOM_PATIENCE)
    else await new Promise((resolve) => setImmediate(resolve))
  }
  return await settled
}

describe('a pull', () => {
  test('answers the rest of its notes when one room does not answer, if the asker asks again', async () => {
    const ids = [await made('A.md', 'a\n'), await made('B.md', 'b\n'), await made('C.md', 'c\n')]
    await prepare()
    const stuck = ids[1] ?? ''
    await frozen(stuck)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const answer = await inFakeTime(pulled(ids, true))

    expect(answer.status).toBe(200)
    expect(updated(answer).map((one) => one.id)).toEqual([ids[0], ids[2]])
  })

  test('is a try-again, not an answer without it, for an asker that does not ask again', async () => {
    const ids = [await made('A.md', 'a\n'), await made('B.md', 'b\n')]
    await prepare()
    await frozen(ids[0] ?? '')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const answer = await inFakeTime(pulled(ids))

    expect(answer.status).toBe(503)
  })

  test('closes its answer at PULL_BYTES for an asker that asks again, and the asking again brings all', async () => {
    const big = 'x'.repeat(1024 * 1024 + 7) + '\n'
    const ids: string[] = []
    for (let at = 0; at < 9; at += 1) ids.push(await made(`N${String(at)}.md`, big))
    await prepare()

    const first = await pulled(ids, true)
    const sizes = updated(first).map((one) => one.update.length)
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.length).toBeLessThan(ids.length)
    expect(sizes.slice(0, -1).reduce((all, one) => all + one, 0)).toBeLessThan(PULL_BYTES)

    const brought = new Set<string>()
    for (let round = 0; round < ids.length && brought.size < ids.length; round += 1) {
      const left = ids.filter((id) => !brought.has(id))
      for (const one of updated(await pulled(left, true))) brought.add(one.id)
    }
    expect(brought.size).toBe(ids.length)
  })

  test('still answers every note to an asker that does not ask again', async () => {
    const big = 'x'.repeat(1024 * 1024 + 7) + '\n'
    const ids: string[] = []
    for (let at = 0; at < 9; at += 1) ids.push(await made(`N${String(at)}.md`, big))
    await prepare()

    expect(updated(await pulled(ids)).map((one) => one.id)).toEqual(ids)
  })
})
