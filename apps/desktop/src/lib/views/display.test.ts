import { answer, builtinView, isWhen, readBase, type View, WHEN } from '@orden/bases'
import { taskRowsOfText } from '@orden/bases/tasks'
import { describe, expect, test } from 'vitest'
import { contextFor } from './context'
import {
  ASSIGNED_TO_ME,
  changedFrom,
  displayed,
  groupingOf,
  shippedGrouping,
  shippedSorting,
  notesIn,
  onlyFilter,
  onlyOf,
  sortingOf,
  withCompleted,
  withGrouping,
  withOnly,
  withSorting,
  UNASSIGNED,
} from './display'
import { dropInto } from './drop'
import { groupLabel, noteNames } from './words'

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

describe('a view grouped by note', () => {
  const rows = [
    ...taskRowsOfText('Notes', 'Alpha/Tasks.md', '- [ ] Alpha one 📅 2026-10-13'),
    ...taskRowsOfText('Notes', 'Beta/Tasks.md', '- [ ] Beta one 📅 2026-10-13'),
    ...taskRowsOfText('Notes', 'Inbox.md', '- [ ] Inbox one 📅 2026-10-13'),
  ]
  const today = builtinView('today')
  const byNote = withGrouping(today, 0, 'note', today.views[0] ?? null)
  const context = contextFor({ rows, today: TODAY, now: `${TODAY}T09:00:00` })
  const groups = answer(displayed(byNote, 0), 0, rows, context).groups
  const keys = groups.map((group) => group.key)

  test('keeps notes of the same name in other folders apart', () => {
    expect(groupingOf(byNote.views[0] ?? today.views[0]!, today.views[0] ?? null)).toBe('note')
    // In the order of the notes' names, the path between two of one name.
    expect(groups.map((group) => group.rows.map((row) => row.task?.text))).toEqual([
      ['Inbox one'],
      ['Alpha one'],
      ['Beta one'],
    ])
  })

  test('names each group by its note, with the folder where two names clash', () => {
    const property = byNote.views[0]?.groupBy?.property
    const names = noteNames(keys)
    expect(keys.map((key) => groupLabel(property, key, TODAY, names))).toEqual([
      'Inbox',
      'Tasks · Alpha',
      'Tasks · Beta',
    ])
  })

  test('a task dropped on a group moves to that note, not one of the same name', () => {
    const property = byNote.views[0]?.groupBy?.property ?? ''
    const inbox = rows[2]!
    expect(dropInto(property, keys[2] ?? null, inbox, TODAY)).toEqual({
      move: { path: 'Beta/Tasks.md' },
    })
  })

  test('a view saved grouped by note name is shown grouped by note', () => {
    const view = byNote.views[0]
    if (!view) throw new Error('no view')
    const saved = {
      ...byNote,
      views: [{ ...view, groupBy: { property: 'file.basename', direction: 'ASC' as const } }],
    }
    expect(displayed(saved, 0).views[0]?.groupBy?.property).toBe('file.path')
    expect(answer(displayed(saved, 0), 0, rows, context).groups).toHaveLength(3)
  })

  test('names two thousand groups at once without asking each of every other', () => {
    const many = Array.from(
      { length: 2000 },
      (_, at) => `Folder ${Math.floor(at / 1000)}/Note ${at % 1000}.md`,
    )
    const started = performance.now()
    const names = noteNames(many)
    const said = many.map((key) => groupLabel('file.path', key, TODAY, names))
    expect(performance.now() - started).toBeLessThan(150)
    expect(said[0]).toBe('Note 0 · Folder 0')
  })
})

// #1046: one view of a space's tasks, with Todoist's Display over it.
describe('the Display menu over Todos', () => {
  const rows = taskRowsOfText(
    'Notes',
    'Errands.md',
    [
      '- [ ] Late #admin [deadline:: 2026-10-12] 🔺 ➕ 2026-10-01',
      '- [ ] Now #home #admin [deadline:: 2026-10-13] [assignee:: Emil] ➕ 2026-10-13',
      '- [/] Doing it [deadline:: 2026-10-14] ➕ 2026-10-10',
      '- [ ] Some day ⏫',
      '- [x] Done already ✅ 2026-10-12',
    ].join('\n'),
  )
  const here = contextFor({ rows, today: TODAY, now: `${TODAY}T09:00:00`, me: 'Emil' })
  const todos = builtinView('todos', { space: 'Notes' })
  const original = todos.views[0] ?? null
  const grouped = (base: ReturnType<typeof builtinView>) =>
    answer(displayed(base, 0), 0, rows, here).groups.map((group) => [
      group.key,
      group.rows.map((row) => row.task?.text),
    ])

  test('comes grouped by when each task is due, sorted the smart way, and says nothing changed', () => {
    expect(shippedGrouping(original)).toBe('due')
    expect(shippedSorting(original)).toBe('smart')
    const view = todos.views[0]
    if (!view) throw new Error('no view')
    expect(changedFrom(view, original)).toEqual({ sort: 0, filter: 0, total: 0 })
    expect(grouped(todos)).toEqual([
      ['overdue', ['Late']],
      ['today', ['Now']],
      ['tomorrow', ['Doing it']],
      [null, ['Some day']],
    ])
  })

  test('groups by label, a task under each of its labels, and by status', () => {
    const byLabel = withGrouping(todos, 0, 'tag', original)
    expect(grouped(byLabel)).toEqual([
      ['admin', ['Late', 'Now']],
      ['home', ['Now']],
      // The smart order: the high priority first.
      [null, ['Some day', 'Doing it']],
    ])
    const byStatus = withGrouping(todos, 0, 'status', original)
    expect(grouped(byStatus).map(([key]) => key)).toEqual([' ', '/'])
    const view = byLabel.views[0]
    if (!view) throw new Error('no view')
    expect(changedFrom(view, original)).toEqual({ sort: 1, filter: 0, total: 1 })
    // Its own grouping chosen again is the view as it came, its order of groups and all.
    const back = withGrouping(byLabel, 0, 'default', original)
    expect(back.views[0]?.nib.groups).toEqual(original?.nib.groups)
  })

  test('a view of another kind grouped by date gets the formula it groups by', () => {
    const today = builtinView('today')
    const byDue = withGrouping(today, 0, 'due', today.views[0] ?? null)
    expect(byDue.formulas.when).toBeDefined()
    expect(groupingOf(byDue.views[0]!, today.views[0] ?? null)).toBe('due')
  })

  test('sorts the smart way, by when it was written down, and counts each change', () => {
    const byCreated = withSorting(todos, 0, 'created', true, original)
    expect(sortingOf(byCreated.views[0]!, original)).toEqual({ sorting: 'created', down: true })
    const smart = withSorting(byCreated, 0, 'smart', false, original)
    expect(sortingOf(smart.views[0]!, original).sorting).toBe('default')
    const many = withCompleted(withOnly(byCreated, 0, { priority: 1, label: 'admin' }), 0, true)
    expect(changedFrom(many.views[0]!, original)).toEqual({ sort: 1, filter: 2, total: 4 })
  })

  test('narrows to when a task was written down and who it is assigned to', () => {
    const words = (base: ReturnType<typeof builtinView>) =>
      answer(displayed(base, 0), 0, rows, here).groups.flatMap((group) =>
        group.rows.map((row) => row.task?.text),
      )
    expect(words(withOnly(todos, 0, { created: 'today' }))).toEqual(['Now'])
    expect(words(withOnly(todos, 0, { created: 'week' })).sort()).toEqual(['Doing it', 'Now'])
    expect(words(withOnly(todos, 0, { created: 'month' })).sort()).toEqual([
      'Doing it',
      'Late',
      'Now',
    ])
    expect(words(withOnly(todos, 0, { assignee: ASSIGNED_TO_ME }))).toEqual(['Now'])
    expect(words(withOnly(todos, 0, { assignee: 'Emil' }))).toEqual(['Now'])
    expect(words(withOnly(todos, 0, { assignee: UNASSIGNED })).sort()).toEqual([
      'Doing it',
      'Late',
      'Some day',
    ])
    const view = withOnly(todos, 0, { created: 'week', assignee: 'Emil' }).views[0]
    if (!view) throw new Error('no view')
    expect(onlyOf(view)).toEqual({ created: 'week', assignee: 'Emil' })
  })

  test('a card carried to another group changes what it is grouped by', () => {
    const [late, now] = rows
    if (!late || !now) throw new Error('no rows')
    expect(dropInto('formula.when', 'today', late, TODAY)).toEqual({
      change: { task: { deadline: TODAY } },
    })
    expect(dropInto('formula.when', 'tomorrow', late, TODAY)).toEqual({
      change: { task: { deadline: '2026-10-14' } },
    })
    expect(dropInto('formula.when', null, now, TODAY)).toEqual({
      change: { task: { deadline: null } },
    })
    // Overdue and Later name no one day.
    expect(dropInto('formula.when', 'later', now, TODAY)).toBeNull()
    expect(dropInto('task.tags', 'work', now, TODAY, 'home')).toEqual({
      change: { task: { tags: ['admin', 'work'] } },
    })
    expect(dropInto('task.tags', null, now, TODAY, 'home')).toEqual({
      change: { task: { tags: ['admin'] } },
    })
    expect(dropInto('task.tags', 'admin', now, TODAY, 'admin')).toBeNull()
  })
})

describe('Date, on a base with a formula of its own called when', () => {
  const own = readBase(`formulas:
  when: task.deadline + "1d"
views:
  - type: list
    name: Mine
    groupBy:
      property: task.priority
      direction: ASC
`)

  test('keeps that formula, and groups by when a task is due under a name of its own', () => {
    const made = withGrouping(own, 0, 'due', null)
    expect(made.formulas.when).toBe('task.deadline + "1d"')
    const by = made.views[0]?.groupBy?.property ?? ''
    expect(by).not.toBe('formula.when')
    expect(made.formulas[by.replace('formula.', '')]).toBe(WHEN)
    expect(isWhen(by)).toBe(true)
    expect(groupingOf(made.views[0] as View, null)).toBe('due')
  })

  test('a base with none, or with Todos\u2019 own, is as it was', () => {
    const none = readBase('views:\n  - type: list\n    name: Mine\n')
    expect(withGrouping(none, 0, 'due', null).views[0]?.groupBy?.property).toBe('formula.when')
    const again = withGrouping(withGrouping(none, 0, 'due', null), 0, 'due', null)
    expect(again.views[0]?.groupBy?.property).toBe('formula.when')
  })
})
