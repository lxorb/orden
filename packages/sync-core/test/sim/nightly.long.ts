import { describe, expect, test } from 'vitest'
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
      const failed: string[] = []
      for (let seed = from; seed < to && failed.length < 5; seed++) {
        const report = await simulate(MIX ? crowded(seed, MIX) : { seed })
        if (report.failures.length)
          failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      }
      expect(failed).toEqual([])
    })
  }
})
