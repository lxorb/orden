/** Random walks of the tree (#1068): moves, renames, deletes and restores crossing on
 *  five devices, some of them offline for long stretches, against the reference account
 *  and devices. They must converge on one tree with nothing duplicated, nothing lost, no
 *  folder inside itself and every restore standing (checks.ts). */

import { describe, expect, test } from 'vitest'
import { simulate } from './run'

const SEEDS = 200

/** Seeds that fail today, each for the one reason the next steps of #1068 take away: a
 *  delete made before a restore, on a device that had not heard of the restore, arrives
 *  after it and takes the note again. The account's rules (`deleted` in src/tree.ts) let
 *  a stale delete stand against a restore as they do not against an edit. */
const STALE_DELETE_AFTER_RESTORE = [113, 122, 146, 188]

async function failures(seed: number): Promise<string[]> {
  return (await simulate({ seed, devices: 5, steps: 80, mix: 'tree' })).failures
}

describe('the tree, walked at random on five devices', () => {
  test('converges with nothing duplicated, lost, cycled or left deleted', async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (STALE_DELETE_AFTER_RESTORE.includes(seed)) continue
      const said = await failures(seed)
      if (said.length) failed.push(`seed ${String(seed)}: ${said.join('; ')}`)
    }
    expect(failed).toEqual([])
  })

  test.fails.each(STALE_DELETE_AFTER_RESTORE)(
    'seed %i: a restore stands against a delete that had not seen it',
    async (seed) => {
      expect(await failures(seed)).toEqual([])
    },
  )

  test('the seeds pinned above fail only for that reason', async () => {
    for (const seed of STALE_DELETE_AFTER_RESTORE) {
      const said = await failures(seed)
      expect(said.length, String(seed)).toBeGreaterThan(0)
      for (const one of said) expect(one, String(seed)).toMatch(/was restored and is not there$/)
    }
  })
})
