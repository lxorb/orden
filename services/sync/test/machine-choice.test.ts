import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spentOn } from '../src/sync-server-machines/src/machines/budget'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { Cloud } from './hetzner-cloud'
import { doorway } from './machine-fakes'

const OWNER = 'owner@example.com'
const ID = 'm_server'
const HETZNER = {
  HETZNER_TOKEN: 'hetzner-token',
  MACHINE_TUNNEL_TOKEN: 'tunnel-token',
  CF_ACCOUNT_ID: 'account',
  CF_ZONE_ID: 'zone',
}
let env: TestEnv
let door: ReturnType<typeof doorway>
let cloud: Cloud
let owner: string
let hour = 0
const machineRow = () =>
  env.db.prepare('select size, region, spec, price_month, price_hour, server_id from machines').get() as Record<
    string,
    unknown
  >
const asked = () => door.asked.map((one) => one.headers.get('x-orden-machine'))
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  hour += 1
  vi.setSystemTime(Date.UTC(2026, 10, 11, hour))
  door = doorway()
  cloud = new Cloud()
  vi.stubGlobal('fetch', cloud.fetch)
  env = testEnv({ MACHINES: door.MACHINES, ...HETZNER })
  owner = await signIn(env, OWNER)
  env.db.prepare("update online_service set value = 'on' where key = 'online'").run()
  env.db.prepare('update users set online = 1 where email = ?').run(OWNER)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  env.close()
})
interface Offered {
  currency: string
  locations: unknown[]
  types: { name: string }[]
}
interface Shown {
  machine: { server: { spent: number | null } }
}
const types = () => call<Offered>(env, '/v2/online/types', { token: owner })
const shownNow = () => call<Shown>(env, '/v2/online/machine', { token: owner })
const choose = (body: Record<string, string>) => call(env, '/v2/online/machine/type', { token: owner, body })
function ceiling(value: string) {
  env.db
    .prepare(
      `insert into online_service (key, value) values ('ceiling', ?1)
       on conflict(key) do update set value = ?1`,
    )
    .run(value)
}
function made(size = 'cx43', price = 14.27, disk = 160) {
  const user = (env.db.prepare('select id from users').get() as { id: string }).id
  env.db
    .prepare(
      `insert into machines (id, user_id, created_at, host, state, server_id, size, region, spec,
         price_month, price_hour, price_currency)
       values (?, ?, 1, 'hetzner', 'awake', 77, ?, 'nbg1', ?, ?, 0.0248, 'EUR')`,
    )
    .run(ID, user, size, JSON.stringify({ cores: 8, memory: 16, disk }), price)
}
describe('the machines on offer', () => {
  test('are Hetzner’s own, live, with their kind and both prices where they can be had', async () => {
    cloud.available = ['nbg1', 'fsn1']
    const answer = await types()
    expect(answer.status).toBe(200)
    expect(answer.json.currency).toBe('EUR')
    expect(answer.json.locations).toEqual([
      { name: 'fsn1', city: 'Falkenstein', country: 'DE' },
      { name: 'nbg1', city: 'Nuremberg', country: 'DE' },
    ])
    const names = answer.json.types.map((one) => one.name)
    expect(names).toEqual(['cx23', 'cx43', 'cx53', 'cax31', 'ccx33'])
    expect(answer.json.types[1]).toEqual({
      name: 'cx43',
      cores: 8,
      memoryGb: 16,
      diskGb: 160,
      cpu: 'shared',
      arch: 'x86',
      prices: [
        { location: 'nbg1', monthly: 14.27, hourly: 0.0248 },
        { location: 'fsn1', monthly: 14.27, hourly: 0.0248 },
      ],
    })
    expect(answer.json.types[3]).toMatchObject({ name: 'cax31', arch: 'arm' })
    expect(answer.json.types[4]).toMatchObject({ name: 'ccx33', cpu: 'dedicated' })
  })
  test('are asked of Hetzner once in ten minutes', async () => {
    await types()
    await types()
    expect(cloud.asked.filter((one) => one.startsWith('GET /server_types'))).toHaveLength(1)
    vi.setSystemTime(Date.now() + 11 * 60_000)
    await types()
    expect(cloud.asked.filter((one) => one.startsWith('GET /server_types'))).toHaveLength(2)
  })
  test('are none where no Hetzner is set up, as on a server from before', async () => {
    const bare = testEnv({ MACHINES: door.MACHINES })
    try {
      const token = await signIn(bare, OWNER)
      bare.db.prepare("update online_service set value = 'on' where key = 'online'").run()
      expect((await call(bare, '/v2/online/types', { token })).status).toBe(404)
    } finally {
      bare.close()
    }
  })
})
describe('choosing a machine before it is made', () => {
  test('keeps the type and place for its first start, and shows them', async () => {
    expect((await choose({ type: 'cax31', location: 'hel1' })).status).toBe(200)
    expect(machineRow()).toMatchObject({
      size: 'cax31',
      region: 'hel1',
      spec: JSON.stringify({ cores: 8, memory: 16, disk: 160 }),
      price_month: 15.46,
      server_id: null,
    })
    const shown = await shownNow()
    expect(shown.json.machine.server).toMatchObject({
      type: 'cax31',
      location: 'hel1',
      made: false,
      spent: null,
    })
    expect(asked()).not.toContain('resize')
  })
  test('refuses a type or place Hetzner does not offer', async () => {
    cloud.available = ['nbg1']
    expect((await choose({ type: 'cx43', location: 'hel1' })).json).toEqual({ error: 'type' })
    expect((await choose({ type: 'cx42', location: 'nbg1' })).json).toEqual({ error: 'type' })
    expect((await choose({ type: 'nope', location: 'nbg1' })).json).toEqual({ error: 'type' })
  })
  test('is not open to an account the service is not open to', async () => {
    env.db.prepare('update users set online = 0').run()
    expect((await choose({ type: 'cx43', location: 'nbg1' })).status).toBe(403)
  })
})
describe('resizing a made machine', () => {
  test('asks the machine to resize to a bigger type, in its own place', async () => {
    ceiling('200')
    made()
    const answer = await choose({ type: 'cx53', location: 'hel1' })
    expect(answer.status).toBe(200)
    expect(asked()).toEqual(['resize'])
    expect(door.asked[0]?.headers.get('x-orden-type')).toBe('cx53')
  })
  test('refuses a smaller disk, and asks the machine nothing', async () => {
    made()
    const answer = await choose({ type: 'cx23' })
    expect(answer.status).toBe(409)
    expect(answer.json).toEqual({ error: 'disk' })
    expect(asked()).toEqual([])
  })
  test('refuses to change between x86 and Arm', async () => {
    made()
    expect((await choose({ type: 'cax31' })).json).toEqual({ error: 'arch' })
    expect(asked()).toEqual([])
  })
  test('refuses what goes past the budget, but never a cheaper one', async () => {
    ceiling('20')
    made()
    expect((await choose({ type: 'ccx33' })).json).toEqual({ error: 'budget' })
    expect(asked()).toEqual([])
    env.db.prepare('delete from machines').run()
    made('ccx33', 75.47, 240)
    expect((await choose({ type: 'cx53' })).status).toBe(200)
    expect(asked()).toEqual(['resize'])
  })
  test('refuses while the machine is starting', async () => {
    made()
    env.db.prepare("update machines set state = 'starting'").run()
    expect((await choose({ type: 'cx53' })).json).toEqual({ error: 'busy' })
  })
  test('shows what the machine has cost this month', async () => {
    made()
    env.db.prepare('update machines set priced_at = ?').run(Date.UTC(2026, 10, 1))
    const shown = await shownNow()
    expect(shown.json.machine.server).toMatchObject({ made: true, price: 14.27, hourly: 0.0248 })
    expect(shown.json.machine.server.spent).toBe(
      spentOn({ price_month: 14.27, price_hour: 0.0248, priced_at: Date.UTC(2026, 10, 1), spent: 0 }, Date.now()),
    )
  })
})
describe('what a machine has cost this month', () => {
  const at = Date.UTC(2026, 10, 11)
  const row = { price_month: 14.27, price_hour: 0.0248, priced_at: Date.UTC(2026, 10, 1), spent: 0 }
  test('is its hours this month at the hourly price, up to the monthly one', () => {
    expect(spentOn(row, at)).toBe(5.95)
    expect(spentOn(row, Date.UTC(2026, 10, 30, 23))).toBe(14.27)
    expect(spentOn({ ...row, price_month: null }, at)).toBeNull()
  })
  test('carries what it cost before a resize, and starts again each month', () => {
    const resized = { ...row, priced_at: Date.UTC(2026, 10, 6), spent: 2.98 }
    expect(spentOn(resized, at)).toBe(5.96)
    expect(spentOn(resized, Date.UTC(2026, 11, 2))).toBe(0.6)
  })
  test('starts at the month’s start for a machine priced before it was kept', () => {
    expect(spentOn({ ...row, priced_at: null }, at)).toBe(5.95)
  })
})
