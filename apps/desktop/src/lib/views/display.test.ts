import { answer, builtinView } from '@nib/bases'
import { taskRowsOfText } from '@nib/bases/tasks'
import { describe, expect, test } from 'vitest'
import { contextFor } from './context'
import {
  displayed,
  groupingOf,
  notesIn,
  onlyFilter,
  onlyOf,
  sortingOf,
  withCompleted,
  withGrouping,
  withOnly,
  withSorting,
} from './display'

const TODAY = '2026-10-13'
const ROWS = taskRowsOfText(
  'Notes',
  'Errands.md',
  [
    // Overdue by its deadline: a start date past is never late (#371).
    '- [ ] Call the bank #admin [deadline:: 2026-10-12] 🔺 📅 2026-10-12',
    '- [ ] Water the plants 📅 2026-10-13',
    '- [ ] Pay rent #admin ⏫ 📅 2026-10-13',
    '- [x] Bread ✅ 2026-10-12 📅 2026-10-13',
  ].join('\n'),
)
const context = contextFor({ rows: ROWS, today: TODAY, now: `${TODAY}T09:00:00` })
const words = (base: ReturnType<typeof builtinView>) =>
  answer(displayed(base, 0), 0, ROWS, context).groups.flatMap((group) =>
    group.rows.map((row) => row.task?.text),
  )

describe('the Display menu', () => {
  const today = builtinView('today')
  const original = today.views[0] ?? null

  test('says the view is as it came, until it is grouped or sorted another way', () => {
    const view = today.views[0]
    if (!view) throw new Error('no view')
    expect(groupingOf(view, original)).toBe('default')
    expect(sortingOf(view, original)).toEqual({ sorting: 'default', down: false })

    const byPriority = withGrouping(today, 0, 'priority', original)
    expect(groupingOf(byPriority.views[0] ?? view, original)).toBe('priority')
    const none = withGrouping(today, 0, 'none', original)
    expect(none.views[0]?.groupBy).toBeUndefined()
    const back = withGrouping(byPriority, 0, 'default', original)
    expect(back.views[0]?.groupBy).toEqual(view.groupBy)

    const byName = withSorting(today, 0, 'name', true, original)
    expect(sortingOf(byName.views[0] ?? view, original)).toEqual({ sorting: 'name', down: true })
    expect(withSorting(byName, 0, 'manual', false, original).views[0]?.sort).toEqual([])
  })

  test('a note grouped by its headings keeps them in the order they are written', () => {
    const view = withGrouping(today, 0, 'section', original).views[0]
    expect(view?.groupBy?.property).toBe('task.section')
    expect(view?.nib.groupOrder).toBe('rows')
  })

  test('done tasks stay in the view, or go', () => {
    expect(words(withCompleted(today, 0, true))).toContain('Bread')
    expect(words(today)).not.toContain('Bread')
  })

  test('narrows to a priority, a label or a day, and says so as the engine reads it', () => {
    expect(onlyFilter({})).toBeNull()
    expect(onlyFilter({ priority: 1, label: 'admin', date: 'today' })).toBe(
      'task.priority == 1 && task.hasTag("admin") && task.date == today()',
    )
    expect(words(withOnly(today, 0, { label: 'admin' })).sort()).toEqual([
      'Call the bank',
      'Pay rent',
    ])
    expect(words(withOnly(today, 0, { date: 'overdue' }))).toEqual(['Call the bank'])
    const narrowed = withOnly(today, 0, { priority: 2 })
    const view = narrowed.views[0]
    if (!view) throw new Error('no view')
    expect(onlyOf(view)).toEqual({ priority: 2 })
    expect(words(withOnly(today, 0, { project: 'Errands.md' }))).toHaveLength(3)
    expect(words(withOnly(today, 0, { project: 'Elsewhere.md' }))).toEqual([])
    expect(notesIn(ROWS)).toEqual([{ path: 'Errands.md', name: 'Errands' }])
    expect(withOnly(narrowed, 0, {}).views[0]?.nib.kept.only).toBeUndefined()
  })
})
