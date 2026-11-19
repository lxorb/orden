import { describe, expect, test } from 'vitest'
import { failedSeeds } from './roads'
import { type Crowd, crowded, simulate } from './run'

const SEEDS = 200

const five = (seed: number, mix: Crowd) => ({ seed, devices: 5, steps: 80, mix })

describe('the tree, walked at random on five devices', () => {
  test.each(['tree', 'order'] as const)(
    'the %s converges with nothing duplicated, lost, cycled or out of place',
    async (mix) => {
      expect(await failedSeeds(1, SEEDS, (seed) => simulate(five(seed, mix)))).toEqual([])
    },
  )

  test.each([113, 122, 146, 149, 188, 720, 1151, 632])(
    'seed %i keeps what was restored and loses no words to a folder delete',
    async (seed) => {
      expect((await simulate(five(seed, 'tree'))).failures).toEqual([])
    },
  )

  test.each([
    ...[528, 558].map((seed) => [seed, 'order'] as const),
    ...[226, 1402, 4561, 5244, 5352, 3175, 3900, 2316, 23652].map((seed) => [seed, 'tree'] as const),
  ])(
    'seed %i of the %s on many devices reads every note as the account does and keeps every word',
    async (seed, mix) => {
      expect((await simulate(crowded(seed, mix))).failures).toEqual([])
    },
  )
})
