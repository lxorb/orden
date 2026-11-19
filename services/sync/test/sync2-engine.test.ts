import { afterEach, describe, expect, test } from 'vitest'
import { CALM, type DeviceAdapter, failedSeeds, type Options, roads, simulate } from '@orden/sync-core/sim'
import { WorkerAccount } from './sync2-account'

type Devices = NonNullable<Options['device']>
async function engineDevices(): Promise<Devices> {
  const path = new URL('../../../apps/desktop/src/lib/sync-client/test/sim-device.ts', import.meta.url).href
  const engine = (await import(/* @vite-ignore */ path)) as {
    EngineDevice: new (...made: Parameters<Devices>) => DeviceAdapter
  }
  return (...made) => new engine.EngineDevice(...made)
}
let made: WorkerAccount[] = []
function closeAll() {
  for (const one of made) one.close()
  made = []
}
afterEach(closeAll)
const account: NonNullable<Options['account']> = (_clock, seeded) => {
  const one = new WorkerAccount(seeded)
  made.push(one)
  return one
}
describe('the engine against the Worker', () => {
  roads(async (script) =>
    simulate({ seed: 7, devices: 2, faults: CALM, script, account, device: await engineDevices() }),
  )
})
test('25 seeds of random walks of the engine against the Worker hold every check', async () => {
  const device = await engineDevices()
  const failed = await failedSeeds(1, 25, async (seed) => {
    const report = await simulate({ seed, account, device })
    closeAll()
    return report
  })
  expect(failed).toEqual([])
}, 300_000)
