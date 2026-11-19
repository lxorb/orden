import { afterEach, describe, expect, test } from 'vitest'
import { CALM, failedSeeds, type Options, roads, simulate } from '@orden/sync-core/sim'
import { WorkerAccount } from './sync2-account'

let made: WorkerAccount[] = []

function closeAll() {
  for (const one of made) one.close()
  made = []
}

afterEach(closeAll)

const worker = (options: Options) =>
  simulate({
    ...options,
    account: (_clock, seeded) => {
      const account = new WorkerAccount(seeded)
      made.push(account)
      return account
    },
  })

describe('the Worker as the simulator’s account', () => {
  roads((script) => worker({ seed: 7, devices: 2, faults: CALM, script }), false)
})

test.each([
  ['random walks hold every check', 25, {}],
  ['rows arranged at random end in the same place everywhere', 10, { devices: 4, steps: 60, mix: 'order' }],
] as const)(
  '%s, %i seeds against the Worker',
  async (_, seeds, more) => {
    const failed = await failedSeeds(1, seeds, async (seed) => {
      const report = await worker({ seed, ...more })
      closeAll()
      return report
    })
    expect(failed).toEqual([])
  },
  300_000,
)
