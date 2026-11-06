import { describe, expect, test } from 'vitest'
import { type Crowd, crowded, simulate } from '@orden/sync-core/sim'
import { EngineDevice } from '../sim-device'

export async function walked(from: number, count: number, mix?: Crowd): Promise<string[]> {
  const failed: string[] = []
  for (let seed = from; seed < from + count && failed.length < 5; seed++) {
    const report = await simulate({
      ...(mix ? crowded(seed, mix) : { seed }),
      device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
    })
    if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
  }
  return failed
}

const QUARTERS = 4

function crowdOf(said: string | undefined): Crowd | undefined {
  if (said === undefined || said === '' || said === 'words') return undefined
  if (said === 'tree' || said === 'order') return said
  throw new Error(`SIM_MIX=${said}: words, tree or order`)
}

export function quarter(index: number) {
  const mix = crowdOf(process.env.SIM_MIX)
  const seeds = Number(process.env.SIM_SEEDS ?? 10_000)
  const from = Number(process.env.SIM_FROM ?? 1)
  const size = Math.ceil(seeds / QUARTERS)
  const start = from + index * size
  const count = Math.max(0, Math.min(size, from + seeds - start))

  describe(`the engine walks${mix ? ` the ${mix}` : ''}`, () => {
    test(`seeds ${String(start)} to ${String(start + count - 1)}`, async () => {
      expect(await walked(start, count, mix)).toEqual([])
    }, 0)
  })
}
