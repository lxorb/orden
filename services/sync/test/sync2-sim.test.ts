import { afterEach, describe, expect, test } from 'vitest'
import { CALM, type Report, simulate, type Step, markersIn } from '@orden/sync-core/sim'
import { WorkerAccount } from './sync2-account'

let made: WorkerAccount[] = []

afterEach(() => {
  for (const one of made) one.close()
  made = []
})

const settle: Step = { t: 'wait', ticks: 40 }

function run(script: readonly Step[]): Promise<Report> {
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    account: (_clock, seeded) => {
      const account = new WorkerAccount(seeded)
      made.push(account)
      return account
    },
  })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

const PLAN = 0

describe('the Worker as the simulator’s account', () => {
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

  test('road 5: a delete landing first is undone by the edit written meanwhile', async () => {
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
})

describe('random walks against the Worker', () => {
  const SEEDS = 25

  test(`${String(SEEDS)} seeds hold every check`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({
        seed,
        account: (_clock, seeded) => {
          const account = new WorkerAccount(seeded)
          made.push(account)
          return account
        },
      })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      for (const one of made) one.close()
      made = []
    }
    expect(failed).toEqual([])
  }, 300_000)
})

describe('rows arranged at random against the Worker', () => {
  const SEEDS = 10

  test(`${String(SEEDS)} seeds end with every row in the same place everywhere`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({
        seed,
        devices: 4,
        steps: 60,
        mix: 'order',
        account: (_clock, seeded) => {
          const account = new WorkerAccount(seeded)
          made.push(account)
          return account
        },
      })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      for (const one of made) one.close()
      made = []
    }
    expect(failed).toEqual([])
  }, 300_000)
})
