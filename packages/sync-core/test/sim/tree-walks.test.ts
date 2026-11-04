/** Random walks of the tree (#1068): moves, renames, deletes and restores crossing on
 *  five devices, some of them offline for long stretches, against the reference account
 *  and devices. They must converge on one tree with nothing duplicated, nothing lost, no
 *  folder inside itself and every restore standing (checks.ts). */

import { describe, expect, test } from 'vitest'
import { simulate } from './run'

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

  /** Each once took a restore again with a delete that had not seen it, arriving after:
   *  the account let a stale delete stand against a restore as it never let one stand
   *  against an edit (#1068). */
  test.each([113, 122, 146, 149, 188, 720, 1151])(
    'seed %i keeps what was restored',
    async (seed) => {
      expect((await simulate({ seed, devices: 5, steps: 80, mix: 'tree' })).failures).toEqual([])
    },
  )

  /** A note another device moved into a folder, which this device then wrote in without
   *  ever having seen it there, was taken with the folder when this device deleted it,
   *  words and all: its writing had made it the note's last changer (#1068). */
  test('seed 632 loses no words to a folder delete', async () => {
    expect((await simulate({ seed: 632, devices: 5, steps: 80, mix: 'tree' })).failures).toEqual([])
  })
})
