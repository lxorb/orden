import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, joined, signIn, type ShareView, testEnv, type TestEnv } from './harness'

const ZURICH = { city: 'Zurich', country: 'CH', clientTcpRtt: 12, asn: 3303 }
const IP = '203.0.113.9'
let env: TestEnv
let owner: string
let space: string
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 25, 9))
  env = testEnv()
  owner = await signIn(env, 'owner@example.com')
  space = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Shared' } })).json.space.id
})
afterEach(() => {
  vi.useRealTimers()
  env.close()
})
type Shown = ShareView['members'][number] & { since?: number | null; lastSeen?: number | null; place?: string | null }
async function members(token: string): Promise<Shown[]> {
  const answer = await call<ShareView>(env, `/v1/spaces/${space}/share`, { token })
  expect(answer.status, answer.text).toBe(200)
  return answer.json.members
}
function opened(token: string, cf?: Record<string, unknown>) {
  return call(env, `/v2/spaces/${space}/feed?since=0`, {
    token,
    headers: { 'cf-connecting-ip': IP, 'x-forwarded-for': IP },
    ...(cf ? { cf } : {}),
  })
}
function seenRow(email: string) {
  return env.db
    .prepare("select seen_at, seen_city, seen_country from space_members where email = ? and item = ''")
    .get(email) as { seen_at: number | null; seen_city: string | null; seen_country: string | null }
}
describe('when a member was last in a space, and from where', () => {
  test('the owner and an admin see since, lastSeen and place', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    const joinedAt = Date.now()
    vi.setSystemTime(Date.now() + 60_000)
    expect((await opened(member, ZURICH)).status).toBe(200)
    const seenAt = Date.now()
    const admin = await joined(env, owner, space, 'admin@example.com', 'admin' as 'write')
    for (const token of [owner, admin]) {
      const shown = (await members(token)).find((one) => one.email === 'b@example.com')
      expect(shown).toMatchObject({ since: joinedAt, lastSeen: seenAt, place: 'Zurich, CH' })
    }
  })
  test('a plain member or a guest gets none of it', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'read')
    await opened(member, ZURICH)
    const link = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'read', mode: 'open' },
    })
    const found = /\/join\/([a-f0-9]+)/.exec(link.json.link?.url ?? '')?.[1] ?? ''
    const guest = (await call(env, `/v1/join/${found}`, { method: 'POST', body: {} })).json.token
    expect((await opened(guest, ZURICH)).status).toBe(200)
    for (const one of await members(member)) {
      expect(one).not.toHaveProperty('since')
      expect(one).not.toHaveProperty('lastSeen')
      expect(one).not.toHaveProperty('place')
    }
    const asked = await call(env, `/v1/spaces/${space}/share`, { token: guest })
    expect(asked.status).toBe(403)
    expect(asked.text).not.toMatch(/since|lastSeen|place|Zurich/)
    const shown = await members(owner)
    expect(shown.find((one) => one.guest !== null)).toMatchObject({ place: 'Zurich, CH' })
  })
  test('an access keeps the city and country and nothing of the address', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    await opened(member, ZURICH)
    expect(seenRow('b@example.com')).toEqual({ seen_at: Date.now(), seen_city: 'Zurich', seen_country: 'CH' })
    const everything = JSON.stringify([
      ...env.db.prepare('select * from space_members').all(),
      ...env.db.prepare('select * from guest_members').all(),
    ])
    expect(everything).not.toContain(IP)
    expect(everything).not.toContain('3303')
    vi.setSystemTime(Date.now() + 11 * 60_000)
    await opened(member)
    expect(seenRow('b@example.com')).toEqual({ seen_at: Date.now(), seen_city: 'Zurich', seen_country: 'CH' })
  })
  test('a member is written down at most once in ten minutes', async () => {
    const member = await joined(env, owner, space, 'b@example.com', 'write')
    await opened(member, ZURICH)
    const first = Date.now()
    vi.setSystemTime(first + 9 * 60_000)
    await opened(member, { city: 'Bern', country: 'CH' })
    expect(seenRow('b@example.com')).toEqual({ seen_at: first, seen_city: 'Zurich', seen_country: 'CH' })
    vi.setSystemTime(first + 10 * 60_000)
    await opened(member, { city: 'Bern', country: 'CH' })
    expect(seenRow('b@example.com')).toEqual({ seen_at: first + 10 * 60_000, seen_city: 'Bern', seen_country: 'CH' })
  })
  test('the owner is not a member, and is written down nowhere', async () => {
    await opened(owner, ZURICH)
    expect(env.db.prepare('select count(*) as n from space_members where seen_at is not null').get()).toEqual({ n: 0 })
  })
})
