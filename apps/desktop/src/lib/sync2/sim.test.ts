import { describe, expect, test } from 'vitest'
import { CALM, crowded, markersIn, type Report, simulate, type Step } from '@orden/sync-core/sim'
import { EngineDevice } from './sim-device'
import { walked } from './walks/walk'

const settle: Step = { t: 'wait', ticks: 40 }

function run(script: readonly Step[]): Promise<Report> {
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
  })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

const PLAN = 0

describe('scripted roads, the engine as every device', () => {
  test('road 2: the laptop that was closed merges character by character, asking nothing', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'laptop mk101z' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 1, words: 'phone mk102z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(
      expect.arrayContaining(['mk101z', 'mk102z']),
    )
    expect(report.account.entries.filter((one) => one.name.includes('from another'))).toEqual([])
  })

  test('road 4: two Untitled.md made apart are two notes, the second numbered', async () => {
    const make = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'create', folder: null, name: 'Untitled.md', words: marker },
    })
    const report = await run([
      { t: 'offline', device: 0 },
      make(0, 'mk201z'),
      make(1, 'mk202z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const names = report.account.entries.map((one) => one.name).sort()
    expect(names).toEqual(['Ideas.md', 'Plan.md', 'Untitled 2.md', 'Untitled.md'])
  })

  test('road 5: a delete landing first is undone by the edit that was written meanwhile', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0.5, words: 'mk301z' } },
      { t: 'act', device: 1, action: { t: 'delete', target: PLAN } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk301z')
  })

  test('road 5, the other order: an edit landing first refuses the delete that had not seen it', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0.5, words: 'mk302z' } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'act', device: 1, action: { t: 'delete', target: PLAN } },
      { t: 'pass', device: 1 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk302z')
  })

  test('road 6: a rename made offline and an edit made elsewhere both hold', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'rename', target: PLAN, name: 'Renamed.md' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 0.3, words: 'mk401z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Renamed.md')).toContain('mk401z')
    expect(textOf(report, 'Plan.md')).toBe('')
  })

  test("the day's note made on two devices is one note with both lines", async () => {
    const append = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'append-day', name: '2026-09-30.md', words: marker },
    })
    const report = await run([
      { t: 'offline', device: 0 },
      append(0, 'mk501z'),
      append(1, 'mk502z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const days = report.account.entries.filter((one) => one.name.startsWith('2026-09-30'))
    expect(days).toHaveLength(1)
    expect(markersIn(textOf(report, '2026-09-30.md'))).toEqual(
      expect.arrayContaining(['mk501z', 'mk502z']),
    )
  })

  test("the space's own inbox made on two devices is one inbox with every task of both, once", async () => {
    const made = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: {
        t: 'create',
        folder: null,
        name: '.Inbox.md',
        words: `- [ ] Call the bank\n- [ ] Buy milk\n- [ ] ${marker}\n`,
      },
    })
    const report = await run([
      { t: 'offline', device: 0 },
      made(0, 'mk701z'),
      made(1, 'mk702z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
      { t: 'pass', device: 0 },
      { t: 'pass', device: 1 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    const inboxes = report.account.entries.filter((one) => one.name.includes('Inbox'))
    expect(inboxes.map((one) => one.name)).toEqual(['.Inbox.md'])
    const text = textOf(report, '.Inbox.md')
    expect(markersIn(text)).toEqual(expect.arrayContaining(['mk701z', 'mk702z']))
    expect(text.match(/Call the bank/g)).toHaveLength(1)
    expect(text.match(/Buy milk/g)).toHaveLength(1)
  })

  test('a sentence rewritten on both sides is held and asked, and Keep both keeps both', async () => {
    const rewrite = (device: number, words: string): Step[] => [
      { t: 'act', device, action: { t: 'cut', note: PLAN, at: 0, length: 36 } },
      { t: 'act', device, action: { t: 'type', note: PLAN, at: 0, words } },
    ]
    const report = await run([
      { t: 'offline', device: 0 },
      ...rewrite(0, 'Let us hold the whole release until every reviewer has signed off mk601z'),
      ...rewrite(1, 'The release goes out on Friday morning whatever the review says mk602z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
      { t: 'answer', device: 0, choice: 'both' },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.held).toBeGreaterThan(0)
    const everything = Object.values(report.account.texts).join('\n')
    expect(everything).toContain('mk601z')
    expect(everything).toContain('mk602z')
    expect(report.account.entries.some((one) => one.name === 'Plan (d0).md')).toBe(true)
  })

  test('a crash loses only what was typed since the last save, and nothing after relaunch', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk701z' } },
      { t: 'act', device: 0, action: { t: 'save' } },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 1, words: 'mk702z' } },
      { t: 'crash', device: 0 },
      { t: 'launch', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const plan = textOf(report, 'Plan.md')
    expect(plan).toContain('mk701z')
    expect(plan).not.toContain('mk702z')
  })

  test('a file changed by another program is folded in three ways', async () => {
    const report = await run([
      {
        t: 'act',
        device: 0,
        action: { t: 'edit-file', note: PLAN, at: 0.2, words: 'mk801z', cut: 0 },
      },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk801z')
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

  async function treeWalk(seed: number): Promise<string[]> {
    const report = await simulate({
      seed,
      devices: 4,
      steps: 60,
      mix: 'tree',
      device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
    })
    return report.failures
  }

  test(`${String(SEEDS)} seeds converge with nothing duplicated, lost or cycled`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const said = await treeWalk(seed)
      if (said.length) failed.push(`seed ${String(seed)}: ${said.join('; ')}`)
    }
    expect(failed).toEqual([])
  }, 600_000)

  test('a note moved and deleted on one device is deleted on the one that was away', async () => {
    const NOTE = 0.4
    const report = await run([
      { t: 'act', device: 0, action: { t: 'mkdir', folder: null, name: 'Work' } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'pass', device: 1 },
      settle,
      { t: 'offline', device: 1 },
      { t: 'act', device: 0, action: { t: 'move', target: NOTE, folder: 0 } },
      { t: 'act', device: 0, action: { t: 'delete', target: NOTE } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'online', device: 1 },
      { t: 'pass', device: 1 },
      settle,
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.account.entries.map((one) => one.name).sort()).toEqual(['Ideas.md', 'Work'])
  })

  test('a note restored from the trash comes back as itself', async () => {
    expect(await treeWalk(3)).toEqual([])
  })

  test.each([2412, 9654, 8388, 15786, 19363, 21591, 25006, 23076])(
    'seed %i of the tree on many devices loses no restore and no words',
    async (seed) => {
      const report = await simulate({
        ...crowded(seed, 'tree'),
        device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
      })
      expect(report.failures).toEqual([])
    },
  )
})

test('seed 49850 of the order on many devices keeps the words in a folder moved into one deleted unseen', async () => {
  const report = await simulate({
    ...crowded(49850, 'order'),
    device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
  })
  expect(report.failures).toEqual([])
})

describe('rows arranged at random, the engine as every device', () => {
  const SEEDS = 30

  test(`${String(SEEDS)} seeds end with every row in the same place everywhere`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({
        seed,
        devices: 4,
        steps: 60,
        mix: 'order',
        device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
      })
      if (report.failures.length) {
        failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      }
    }
    expect(failed).toEqual([])
  }, 600_000)
})
