import { describe, expect, test } from 'vitest'
import { failedSeeds } from './roads'
import { type Crowd, crowded, simulate } from './run'

const SAID = process.env.SIM_MIX
const MIX: Crowd | undefined =
  SAID === 'tree' || SAID === 'order'
    ? SAID
    : SAID === undefined || SAID === '' || SAID === 'words'
      ? undefined
      : (() => {
          throw new Error(`SIM_MIX=${SAID}: words, tree or order`)
        })()
const SEEDS = Number(process.env.SIM_SEEDS ?? (MIX ? 10_000 : 1_000_000))
const CHUNK = Math.min(SEEDS, MIX ? 1_000 : 10_000)
const START = Number(process.env.SIM_FROM ?? Math.floor(Date.now() / 86_400_000) * SEEDS)
describe(`nightly walks${MIX ? ` of the ${MIX}` : ''}`, () => {
  for (let chunk = 0; chunk < Math.ceil(SEEDS / CHUNK); chunk++) {
    const from = START + chunk * CHUNK
    const to = Math.min(from + CHUNK, START + SEEDS)
    test(`seeds ${String(from)} to ${String(to - 1)}`, async () => {
      const report = (seed: number) => simulate(MIX ? crowded(seed, MIX) : { seed })
      expect(await failedSeeds(from, to - from, report)).toEqual([])
    })
  }
})
