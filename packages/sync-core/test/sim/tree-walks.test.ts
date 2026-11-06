import { describe, expect, test } from 'vitest'
import { crowded, simulate } from './run'

const SEEDS = 200

describe('the tree, walked at random on five devices', () => {
  test('converges with nothing duplicated, lost, cycled or left deleted', async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({ seed, devices: 5, steps: 80, mix: 'tree' })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
    }
    expect(failed).toEqual([])
  })

  test.each([113, 122, 146, 149, 188, 720, 1151])(
    'seed %i keeps what was restored',
    async (seed) => {
      expect((await simulate({ seed, devices: 5, steps: 80, mix: 'tree' })).failures).toEqual([])
    },
  )

  test('seed 632 loses no words to a folder delete', async () => {
    expect((await simulate({ seed: 632, devices: 5, steps: 80, mix: 'tree' })).failures).toEqual([])
  })

  test('ends with every row in the same place everywhere', async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({ seed, devices: 5, steps: 80, mix: 'order' })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
    }
    expect(failed).toEqual([])
  })

  test.each([
    [528, 'order'],
    [558, 'order'],
    [226, 'tree'],
    [1402, 'tree'],
  ] as const)(
    'seed %i of the %s on many devices reads every note as the account does',
    async (seed, mix) => {
      expect((await simulate(crowded(seed, mix))).failures).toEqual([])
    },
  )

  test.each([4561, 5244, 5352])(
    'seed %i of the tree on many devices keeps every word a person did not take out',
    async (seed) => {
      expect((await simulate(crowded(seed, 'tree'))).failures).toEqual([])
    },
  )

  test.each([3175, 3900])(
    'seed %i of the tree on many devices keeps what another device restored',
    async (seed) => {
      expect((await simulate(crowded(seed, 'tree'))).failures).toEqual([])
    },
  )

  test('seed 2316 of the tree on many devices keeps a folder restored here', async () => {
    expect((await simulate(crowded(2316, 'tree'))).failures).toEqual([])
  })

  test('seed 23652 of the tree on many devices lets a delete asked for after a restore stand', async () => {
    expect((await simulate(crowded(23652, 'tree'))).failures).toEqual([])
  })
})
