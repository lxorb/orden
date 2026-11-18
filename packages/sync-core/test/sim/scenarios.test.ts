import { describe, expect, test } from 'vitest'
import { CALM } from './network'
import { act, pass, PLAN, roads, settle } from './roads'
import { type Report, type Step, simulate } from './run'

function run(script: readonly Step[], plant?: 'delete-without-seen'): Promise<Report> {
  return simulate({ seed: 7, devices: 2, faults: CALM, script, ...(plant ? { plant } : {}) })
}

describe('scripted roads', () => roads(run))

describe('the planted bug', () => {
  const script: Step[] = [
    act(0, { t: 'type', note: PLAN, at: 0.5, words: 'mk901z' }),
    pass(0),
    settle,
    act(1, { t: 'delete', target: PLAN }),
    pass(1),
    settle,
  ]

  test('the reference account keeps words a delete never saw', async () => {
    expect((await run(script)).failures).toEqual([])
  })

  test('an account that deletes without the seen check is caught, scripted', async () => {
    const report = await run(script, 'delete-without-seen')
    expect(report.failures).toContain('mk901z was typed and is in no note and no version')
  })

  test('and caught by the random walks, without being told where to look', async () => {
    let caught = 0
    for (let seed = 1; seed <= 200; seed++) {
      const report = await simulate({ seed, plant: 'delete-without-seen' })
      if (report.failures.length) caught += 1
    }
    expect(caught).toBeGreaterThan(0)
  })
})
