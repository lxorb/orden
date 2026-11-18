import { expect, test } from 'vitest'
import type { Action } from './adapters'
import { markersIn } from './checks'
import type { Report, Step } from './run'

export const settle: Step = { t: 'wait', ticks: 40 }

export const PLAN = 0

export const act = (device: number, action: Action): Step => ({ t: 'act', device, action })

export const pass = (device: number): Step => ({ t: 'pass', device })

export function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

export function apart(here: readonly Step[], there: readonly Step[], ...after: Step[]): Step[] {
  return [
    { t: 'offline', device: 0 },
    ...here,
    ...there,
    pass(1),
    settle,
    { t: 'online', device: 0 },
    pass(0),
    settle,
    ...after,
  ]
}

export async function failedSeeds(
  from: number,
  count: number,
  report: (seed: number) => Promise<Report>,
): Promise<string[]> {
  const failed: string[] = []
  for (let seed = from; seed < from + count && failed.length < 5; seed++) {
    const { failures } = await report(seed)
    if (failures.length) failed.push(`seed ${String(seed)}: ${failures.join('; ')}`)
  }
  return failed
}

export function roads(run: (script: readonly Step[]) => Promise<Report>, every = true): void {
  test('road 2: the laptop that was closed merges character by character, asking nothing', async () => {
    const report = await run(
      apart(
        [act(0, { t: 'type', note: PLAN, at: 0, words: 'laptop mk101z' })],
        [act(1, { t: 'type', note: PLAN, at: 1, words: 'phone mk102z' })],
      ),
    )
    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(
      expect.arrayContaining(['mk101z', 'mk102z']),
    )
    expect(report.account.entries.filter((one) => one.name.includes('from another'))).toEqual([])
  })

  test('road 4: two Untitled.md made apart are two notes, the second numbered', async () => {
    const make = (device: number, words: string) =>
      act(device, { t: 'create', folder: null, name: 'Untitled.md', words })
    const report = await run(apart([make(0, 'mk201z')], [make(1, 'mk202z')]))
    expect(report.failures).toEqual([])
    const names = report.account.entries.map((one) => one.name).sort()
    expect(names).toEqual(['Ideas.md', 'Plan.md', 'Untitled 2.md', 'Untitled.md'])
  })

  test('road 5: a delete landing first is undone by the edit that was written meanwhile', async () => {
    const report = await run(
      apart(
        [act(0, { t: 'type', note: PLAN, at: 0.5, words: 'mk301z' })],
        [act(1, { t: 'delete', target: PLAN })],
      ),
    )
    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk301z')
  })

  test('road 5, the other order: an edit landing first refuses the delete that had not seen it', async () => {
    const report = await run([
      act(0, { t: 'type', note: PLAN, at: 0.5, words: 'mk302z' }),
      pass(0),
      settle,
      act(1, { t: 'delete', target: PLAN }),
      pass(1),
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk302z')
  })

  test('road 6: a rename made offline and an edit made elsewhere both hold', async () => {
    const report = await run(
      apart(
        [act(0, { t: 'rename', target: PLAN, name: 'Renamed.md' })],
        [act(1, { t: 'type', note: PLAN, at: 0.3, words: 'mk401z' })],
      ),
    )
    expect(report.failures).toEqual([])
    expect(textOf(report, 'Renamed.md')).toContain('mk401z')
    expect(textOf(report, 'Plan.md')).toBe('')
  })

  if (!every) return

  test("the day's note made on two devices is one note with both lines", async () => {
    const append = (device: number, words: string) =>
      act(device, { t: 'append-day', name: '2026-09-30.md', words })
    const report = await run(apart([append(0, 'mk501z')], [append(1, 'mk502z')], pass(0), settle))
    expect(report.failures).toEqual([])
    const days = report.account.entries.filter((one) => one.name.startsWith('2026-09-30'))
    expect(days).toHaveLength(1)
    expect(markersIn(textOf(report, '2026-09-30.md'))).toEqual(
      expect.arrayContaining(['mk501z', 'mk502z']),
    )
  })

  test('a sentence rewritten on both sides is held and asked, and Keep both keeps both', async () => {
    const rewrite = (device: number, words: string): Step[] => [
      act(device, { t: 'cut', note: PLAN, at: 0, length: 36 }),
      act(device, { t: 'type', note: PLAN, at: 0, words }),
    ]
    const report = await run(
      apart(
        rewrite(0, 'Let us hold the whole release until every reviewer has signed off mk601z'),
        rewrite(1, 'The release goes out on Friday morning whatever the review says mk602z'),
        { t: 'answer', device: 0, choice: 'both' },
        pass(0),
        settle,
      ),
    )
    expect(report.failures).toEqual([])
    expect(report.held).toBeGreaterThan(0)
    const everything = Object.values(report.account.texts).join('\n')
    expect(everything).toContain('mk601z')
    expect(everything).toContain('mk602z')
    expect(report.account.entries.some((one) => one.name === 'Plan (d0).md')).toBe(true)
  })

  test('a crash loses only what was typed since the last save, and nothing after relaunch', async () => {
    const report = await run([
      act(0, { t: 'type', note: PLAN, at: 0, words: 'mk701z' }),
      act(0, { t: 'save' }),
      act(0, { t: 'type', note: PLAN, at: 1, words: 'mk702z' }),
      { t: 'crash', device: 0 },
      { t: 'launch', device: 0 },
      pass(0),
      settle,
    ])
    expect(report.failures).toEqual([])
    const plan = textOf(report, 'Plan.md')
    expect(plan).toContain('mk701z')
    expect(plan).not.toContain('mk702z')
  })

  test('a file changed by another program is folded in three ways', async () => {
    const report = await run([
      act(0, { t: 'edit-file', note: PLAN, at: 0.2, words: 'mk801z', cut: 0 }),
      pass(0),
      settle,
    ])
    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk801z')
  })
}
