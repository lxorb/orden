import { describe, expect, test } from 'vitest'
import {
  act,
  apart,
  CALM,
  crowded,
  failedSeeds,
  markersIn,
  type Options,
  pass,
  type Report,
  roads,
  settle,
  simulate,
  type Step,
  textOf,
} from '@orden/sync-core/sim'
import { EngineDevice } from '../test/sim-device'
import { walked } from '../test/walks/walk'

const engine = (options: Options): Promise<Report> =>
  simulate({
    ...options,
    device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
  })

const run = (script: readonly Step[]) => engine({ seed: 7, devices: 2, faults: CALM, script })

describe('scripted roads, the engine as every device', () => {
  roads(run)

  test("the space's own inbox made on two devices is one inbox with every task of both, once", async () => {
    const made = (device: number, marker: string) =>
      act(device, {
        t: 'create',
        folder: null,
        name: '.Inbox.md',
        words: `- [ ] Call the bank\n- [ ] Buy milk\n- [ ] ${marker}\n`,
      })
    const report = await run(
      apart([made(0, 'mk701z')], [made(1, 'mk702z')], pass(0), pass(1), settle),
    )
    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    const inboxes = report.account.entries.filter((one) => one.name.includes('Inbox'))
    expect(inboxes.map((one) => one.name)).toEqual(['.Inbox.md'])
    const text = textOf(report, '.Inbox.md')
    expect(markersIn(text)).toEqual(expect.arrayContaining(['mk701z', 'mk702z']))
    expect(text.match(/Call the bank/g)).toHaveLength(1)
    expect(text.match(/Buy milk/g)).toHaveLength(1)
  })
})

describe('random walks, the engine as every device', () => {
  const SEEDS = 300

  test(`${String(SEEDS)} seeds hold every check`, async () => {
    expect(await walked(1, SEEDS)).toEqual([])
  }, 600_000)

  const ONCE_FAILED = [207340730, 207384677, 644000557, 611000297, 622002257, 1111002428]

  test.each(ONCE_FAILED)('seed %i, which once failed, holds every check', async (seed) => {
    expect(await walked(seed, 1)).toEqual([])
  })
})

describe('the tree walked at random, the engine as every device', () => {
  const SEEDS = 40
  const treeWalk = (seed: number) => engine({ seed, devices: 4, steps: 60, mix: 'tree' })

  test(`${String(SEEDS)} seeds converge with nothing duplicated, lost or cycled`, async () => {
    expect(await failedSeeds(1, SEEDS, treeWalk)).toEqual([])
  }, 600_000)

  test('a note moved and deleted on one device is deleted on the one that was away', async () => {
    const NOTE = 0.4
    const report = await run([
      act(0, { t: 'mkdir', folder: null, name: 'Work' }),
      pass(0),
      settle,
      pass(1),
      settle,
      { t: 'offline', device: 1 },
      act(0, { t: 'move', target: NOTE, folder: 0 }),
      act(0, { t: 'delete', target: NOTE }),
      pass(0),
      settle,
      { t: 'online', device: 1 },
      pass(1),
      settle,
      pass(0),
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(report.account.entries.map((one) => one.name).sort()).toEqual(['Ideas.md', 'Work'])
  })

  test('a note restored from the trash comes back as itself', async () => {
    expect((await treeWalk(3)).failures).toEqual([])
  })

  test.each([
    ...[2412, 9654, 8388, 15786, 19363, 21591, 25006, 23076].map((seed) => [seed, 'tree'] as const),
    [49850, 'order'] as const,
  ])('seed %i of the %s on many devices loses no restore and no words', async (seed, mix) => {
    expect((await engine(crowded(seed, mix))).failures).toEqual([])
  })
})

test('30 seeds of rows arranged at random end with every row in the same place everywhere, the engine as every device', async () => {
  const order = (seed: number) => engine({ seed, devices: 4, steps: 60, mix: 'order' })
  expect(await failedSeeds(1, 30, order)).toEqual([])
}, 600_000)
