import { beforeEach, describe, expect, test } from 'vitest'
import { type Kept, type PushWorld, registrar } from './registrar'

interface Server {
  targets: Map<string, { token: string; app: string; session: string }>
  down: boolean
  asked: string[]
}
let server: Server
let kept: Kept | null
let me: { user: string; session: string } | null
let token: string
let made = 0
function world(): PushWorld {
  return {
    app: 'chat',
    token: () => Promise.resolve(token),
    me: () => me,
    kept: () => kept,
    keep: (next) => {
      kept = next
    },
    register: (session, body) => {
      server.asked.push(`register ${body.token ?? ''}`)
      if (server.down) return Promise.reject(new Error('offline'))
      const had = [...server.targets].find(([, one]) => one.token === body.token)
      const id = had?.[0] ?? `t${String(++made)}`
      server.targets.set(id, { token: body.token ?? '', app: body.app ?? '', session })
      return Promise.resolve(id)
    },
    remove: (_session, id) => {
      server.asked.push(`remove ${id}`)
      if (server.down) return Promise.reject(new Error('offline'))
      server.targets.delete(id)
      return Promise.resolve()
    },
    zone: () => 'Europe/Zurich',
  }
}
const tokens = () => [...server.targets.values()].map((one) => one.token).sort()
beforeEach(() => {
  server = { targets: new Map(), down: false, asked: [] }
  kept = null
  me = { user: 'u1', session: 's1' }
  token = 'fcm-1'
  made = 0
})
describe('the phone’s push token', () => {
  test('is registered once signed in, under the app’s name', async () => {
    await registrar(world()).settle()
    expect([...server.targets.values()]).toEqual([{ token: 'fcm-1', app: 'chat', session: 's1' }])
    expect(kept).toEqual({ token: 'fcm-1', id: 't1', user: 'u1' })
  })
  test('is not registered while signed out, nor before the phone has one', async () => {
    me = null
    await registrar(world()).settle()
    me = { user: 'u1', session: 's1' }
    token = ''
    await registrar(world()).settle()
    expect(server.asked).toEqual([])
  })
  test('is registered once however often the page asks', async () => {
    const one = registrar(world())
    await Promise.all([one.settle(), one.settle(), one.settle()])
    await one.settle()
    expect(server.asked).toEqual(['register fcm-1'])
  })
  test('is registered again when the app starts again, so a target the server lost comes back', async () => {
    await registrar(world()).settle()
    server.targets.clear()
    await registrar(world()).settle()
    expect(tokens()).toEqual(['fcm-1'])
  })
  test('that rotates takes the old one off and puts the new one on', async () => {
    const one = registrar(world())
    await one.settle()
    token = 'fcm-2'
    await one.settle()
    expect(tokens()).toEqual(['fcm-2'])
    expect(kept).toEqual({ token: 'fcm-2', id: 't2', user: 'u1' })
  })
  test('that rotates while the server is away is put right at the next try', async () => {
    const one = registrar(world())
    await one.settle()
    token = 'fcm-2'
    server.down = true
    await one.settle()
    expect(tokens()).toEqual(['fcm-1'])
    server.down = false
    await one.settle()
    expect(tokens()).toEqual(['fcm-2'])
  })
  test('is forgotten here on sign-out, and the next account registers it as its own', async () => {
    const one = registrar(world())
    await one.settle()
    me = null
    await one.settle()
    expect(kept).toBeNull()
    expect(server.asked).toEqual(['register fcm-1'])
    server.targets.clear()
    me = { user: 'u2', session: 's2' }
    await one.settle()
    expect([...server.targets.values()]).toEqual([{ token: 'fcm-1', app: 'chat', session: 's2' }])
    expect(kept).toEqual({ token: 'fcm-1', id: 't2', user: 'u2' })
  })
  test('kept from another account is never taken off with this account’s session', async () => {
    kept = { token: 'fcm-0', id: 'theirs', user: 'u0' }
    await registrar(world()).settle()
    expect(server.asked).toEqual(['register fcm-1'])
    expect(kept).toEqual({ token: 'fcm-1', id: 't1', user: 'u1' })
  })
  test('is not kept when the account changed while the server answered', async () => {
    const slow = world()
    const register = slow.register
    slow.register = async (session, body) => {
      const id = await register(session, body)
      me = null
      return id
    }
    await registrar(slow).settle()
    expect(kept).toBeNull()
  })
})
