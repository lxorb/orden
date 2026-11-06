/** Random walks of the tree (#1068): moves, renames, deletes and restores crossing on
 *  five devices, some of them offline for long stretches, against the reference account
 *  and devices. They must converge on one tree with nothing duplicated, nothing lost, no
 *  folder inside itself and every restore standing (checks.ts). */

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

  /** The same with rows dragged among the rest of their folders as well: every device
   *  ends with each row where the account has it, so two people arranging one folder
   *  at once both keep what they did (#1068). */
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

  /** Each deleted, restored and deleted again a note while away, and its own restore
   *  hid from the account another device's restore in between, which the second delete
   *  had never seen (#1068). */
  test.each([3175, 3900])(
    'seed %i of the tree on many devices keeps what another device restored',
    async (seed) => {
      expect((await simulate(crowded(seed, 'tree'))).failures).toEqual([])
    },
  )
})
