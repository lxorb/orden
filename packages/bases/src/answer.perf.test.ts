import { expect, test } from 'vitest'
import { answer, compileView } from './answer'
import { readBase } from './base-file'
import { builtinView } from './builtins'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Row } from './types'

const CLOCKED = process.env.ORDEN_PERF === '1'

const context = contextAt()
const days = ['2026-09-28', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-09', '2026-11-01']
const marks = [' ', ' ', ' ', 'x', '/']

const tasks: Row[] = Array.from({ length: 10_000 }, (_, at) =>
  taskRow(
    `Folder ${at % 40}/Note ${at % 5000}.md`,
    `- [${marks[at % marks.length] ?? ' '}] Task ${at} #tag${at % 7} ${['🔺', '⏫', '', ''][at % 4] ?? ''} 📅 ${days[at % days.length] ?? ''}`,
    at % 20,
    { section: [`Heading ${at % 3}`] },
  ),
)
const notes: Row[] = Array.from({ length: 5000 }, (_, at) =>
  noteRow(`Folder ${at % 40}/Note ${at}.md`, {
    status: ['To do', 'Doing', 'Done'][at % 3] ?? null,
    pages: at % 700,
    rating: at % 5,
  }),
)

const table = readBase(`filters:
  and:
    - file.inFolder("Folder 1") || pages > 100
formulas:
  long: pages > 400
views:
  - type: table
    name: T
    groupBy:
      property: status
      direction: ASC
    sort:
      - property: pages
        direction: DESC
    summaries:
      pages: Sum
      rating: Average
      formula.long: Checked
`)

function timed(run: () => unknown, times = 5): number {
  let best = Infinity
  for (let one = 0; one < times; one++) {
    const started = performance.now()
    run()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

test('Today over ten thousand tasks', () => {
  const today = builtinView('today')
  const result = answer(today, 0, tasks, context)
  expect(result.total).toBeGreaterThan(1000)

  const whole = timed(() => answer(builtinView('today'), 0, tasks, context))
  if (CLOCKED) expect(whole).toBeLessThan(20)
})

test('answered again after one row changed', () => {
  const view = compileView(builtinView('today'))
  view.answer(tasks, context)
  const changed = [...tasks]
  changed[5] = taskRow('Folder 5/Note 5.md', '- [ ] Changed 📅 2026-10-04', 5)
  const again = timed(() => view.answer(changed, context))
  expect(
    view
      .answer(changed, context)
      .groups.some((group) => group.rows.some((row) => row.task?.text === 'Changed')),
  ).toBe(true)
  if (CLOCKED) expect(again).toBeLessThan(10)
})

test('a table of five thousand notes, grouped and summarised', () => {
  const result = answer(table, 'T', notes, context)
  expect(result.groups.map((group) => group.key)).toEqual(['Doing', 'Done', 'To do'])

  const whole = timed(() => answer(structuredClone(table), 'T', notes, context))
  if (CLOCKED) expect(whole).toBeLessThan(20)
})
