/** A room's or a chat's socket lasts no longer than the sign-in it arrived with (#520):
 *  a session that runs out, which nothing announces, closes its sockets the next time
 *  anything is said where they are. See src/signins.ts. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { subprotocol } from '@nib/rooms'
import { sha256 } from '../src/crypto'
import type { Person } from '../src/chats/log'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { ChatSocket, chatLogs, say as sayInChat } from './chat-fakes'
import { doorway, FakeSocket, running } from './room'

let env: TestEnv

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 19, 12))
  env = testEnv()
})

afterEach(() => {
  vi.useRealTimers()
  env.close()
})

/** A session that ran out: its row is still there, past its time. */
async function runOut(token: string): Promise<void> {
  env.db.prepare('update sessions set expires_at = 1 where token_hash = ?').run(await sha256(token))
}

describe('the doors', () => {
  test('hand a room the sign-in a socket arrived with', async () => {
    const token = await signIn(env, 'a@b.dev')
    const space = (await call(env, '/v1/spaces', { token, body: { name: 'S' } })).json.space.id
    const note = (
      await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'a.md', content: 'a' } })
    ).json.note.id
    const door = doorway()
    env.ROOMS = door.ROOMS

    await call(env, `/rooms/${note}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })
    expect(door.asked.at(-1)?.get('x-nib-login')).toBe(await sha256(token))
  })
})

describe('a room', () => {
  test('closes a socket whose session ran out, the next time anybody types', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const laptop = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'S' } })).json.space
      .id
    const note = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token: owner,
        body: { path: 'a.md', content: 'one\n' },
      })
    ).json.note.id
    const live = running(env)
    env.ROOMS = live.ROOMS
    const { room } = live.of(note)
    const who = (await call(env, '/v1/me', { token: owner })).json.user.id

    const enter = async (token: string) => {
      const socket = new FakeSocket()
      await room.enter(
        socket as unknown as WebSocket,
        { noteId: note, spaceId: space, kind: 'words' },
        { writes: true, who, login: await sha256(token) },
      )
      return socket
    }
    const kept = await enter(owner)
    const lost = await enter(laptop)
    await runOut(laptop)

    // Anything at all said in the room is when it asks.
    await room.webSocketMessage(kept as unknown as WebSocket, new Uint8Array([1, 0]).buffer)

    expect(lost.closedWith?.code).toBe(4401)
    expect(kept.closed).toBe(false)
    // And the row stays: the person still has the file open on the other device.
    expect(
      env.db.prepare('select count(*) as held from room_sockets where note_id = ?').get(note),
    ).toEqual({ held: 1 })
  })

  test('and asks at most once a minute', async () => {
    const owner = await signIn(env, 'owner@example.com')
    const space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'S' } })).json.space
      .id
    const note = (
      await call(env, `/v1/spaces/${space}/notes`, {
        token: owner,
        body: { path: 'a.md', content: 'one\n' },
      })
    ).json.note.id
    const live = running(env)
    env.ROOMS = live.ROOMS
    const { room } = live.of(note)
    const socket = new FakeSocket()
    await room.enter(
      socket as unknown as WebSocket,
      { noteId: note, spaceId: space, kind: 'words' },
      { writes: true, who: 'someone', login: await sha256(owner) },
    )
    const said = new Uint8Array([1, 0]).buffer

    await room.webSocketMessage(socket as unknown as WebSocket, said)
    await runOut(owner)
    await room.webSocketMessage(socket as unknown as WebSocket, said)
    expect(socket.closed).toBe(false)

    vi.setSystemTime(Date.now() + 60_000)
    await room.webSocketMessage(socket as unknown as WebSocket, said)
    expect(socket.closedWith?.code).toBe(4401)
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })
})

describe('a chat', () => {
  test('closes a socket whose session ran out, the next time anybody says anything', async () => {
    const phone = await signIn(env, 'chat@example.com')
    const laptop = await signIn(env, 'chat@example.com')
    const logs = chatLogs(env)
    const held = logs.of('c_one')
    await held.log.fetch(
      new Request('https://chats.invalid/', {
        headers: { 'x-nib-chat-ask': 'events', 'x-nib-chat': 'c_one', 'x-nib-space': 'space-1' },
      }),
    )
    const person: Person = { id: 'user-1', guest: false, who: 'user:user-1', role: 'owner' }

    const enter = async (token: string) => {
      const socket = new ChatSocket()
      await held.log.enter(socket as unknown as WebSocket, person, await sha256(token))
      await sayInChat(held, socket, { t: 'hello' })
      return socket
    }
    const kept = await enter(phone)
    vi.setSystemTime(Date.now() + 60_000)
    const lost = await enter(laptop)
    await runOut(laptop)
    vi.setSystemTime(Date.now() + 60_000)

    await sayInChat(held, kept, { t: 'typing' })

    expect(lost.closedWith?.code).toBe(4401)
    expect(kept.closed).toBe(false)
  })
})
