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
interface Shown {
  machine: { server: { type: string; made: boolean; price: number; hourly: number; spent: number | null } | null }
}
const shownNow = () => call<Shown>(env, '/v2/online/machine', { token: owner })
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
describe('the online machine', () => {
  test('is one default machine: no types are offered and none can be chosen', async () => {
    expect((await call(env, '/v2/online/types', { token: owner })).status).toBe(404)
    const chosen = await call(env, '/v2/online/machine/type', {
      token: owner,
      body: { type: 'cax31', location: 'hel1' },
    })
    expect(chosen.status).toBe(404)
    expect(machineRow()).toBeUndefined()
    expect(cloud.asked).toEqual([])
    expect(asked()).toEqual([])
  })
  test('shows no server for a type chosen before but never made', async () => {
    made()
    env.db.prepare("update machines set server_id = null, size = 'cax31', region = 'hel1'").run()
    expect((await shownNow()).json.machine.server).toBeNull()
  })
  test('shows a made machine as it is, with what it has cost this month', async () => {
    made('ccx33', 75.47, 240)
    env.db.prepare('update machines set priced_at = ?').run(Date.UTC(2026, 10, 1))
    const shown = await shownNow()
    expect(shown.json.machine.server).toMatchObject({ type: 'ccx33', made: true, price: 75.47, hourly: 0.0248 })
    expect(shown.json.machine.server?.spent).toBe(
      spentOn({ price_month: 75.47, price_hour: 0.0248, priced_at: Date.UTC(2026, 10, 1), spent: 0 }, Date.now()),
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
