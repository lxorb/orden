import { describe, expect, test } from 'vitest'
import { answer } from './answer'
import { readBase, writeBase } from './base-file'
import { builtinView, todayAs, WHEN_ASIDE, whenAs } from './builtins'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Answer, Row } from './types'

const context = contextAt()
const keyed = (result: Answer) =>
  result.groups.map((group) => [group.key, group.rows.map((row) => row.task?.text)])

const rows: Row[] = [
  taskRow('Inbox.md', '- [ ] Call the bank [time:: 16:00] ⏫ 🛫 2026-10-04', 0),
  taskRow('Inbox.md', '- [ ] Renew passport [deadline:: 2026-09-26] 🛫 2026-09-20', 1),
  taskRow('Inbox.md', '- [ ] Old date 📅 2026-09-26', 2),
  taskRow('Inbox.md', '- [ ] Draft talk [deadline:: 2026-10-20] ⏳ 2026-10-04', 3),
  taskRow('Errands.md', '- [ ] Gym [time:: 07:30] 🔺 🛫 2026-10-04', 0, { section: ['Health'] }),
  taskRow('Errands.md', '- [ ] Taxes [deadline:: 2026-10-12] 🛫 2026-10-10', 1, {
    section: ['Admin'],
  }),
  taskRow('Errands.md', '- [ ] Dentist 🛫 2026-10-06', 2, { section: ['Health'] }),
  taskRow('Errands.md', '- [x] Water ✅ 2026-10-03', 3, { section: ['Home'] }),
  taskRow('Errands.md', '- [-] Gym old ❌ 2026-10-02', 4, { section: ['Home'] }),
  taskRow('Errands.md', '- [ ] Review PR #work [assignee:: Emil] 🛫 2026-10-05', 5),
  taskRow('Errands.md', '- [ ] Fix the bug #work [assignee:: Emil]', 6),
  taskRow('Work.md', '- [ ] Ship it #work', 0, { space: 'Work' }),
  taskRow('Inbox.md', '- [ ] Elsewhere', 0, { space: 'Work' }),
  taskRow('Vault.md', '- [ ] Vault due 📅 2026-10-01', 0, { space: 'Vault', dueReads: 'deadline' }),
  taskRow('Vault.md', '- [ ] Vault later 📅 2026-10-08', 1, {
    space: 'Vault',
    dueReads: 'deadline',
  }),
  noteRow('Projects/Thesis.md', {}, { tags: ['work'] }),
]

describe('the built-in views', () => {
  test('Todos: a space’s started tasks by when they are due, the undated last, done ones out', () => {
    const due = [
      taskRow('Due.md', '- [ ] Late [deadline:: 2026-10-01]', 0),
      taskRow('Due.md', '- [ ] Now [deadline:: 2026-10-04]', 1),
      taskRow('Due.md', '- [ ] Next 🔼 [deadline:: 2026-10-05]', 2),
      taskRow('Due.md', '- [ ] Next first ⏫ [deadline:: 2026-10-05]', 3),
      taskRow('Due.md', '- [ ] Far [deadline:: 2026-11-30]', 4),
      taskRow('Due.md', '- [ ] Waiting 🛫 2026-10-09 [deadline:: 2026-10-10]', 5),
      taskRow('Due.md', '- [x] Done [deadline:: 2026-10-04]', 6),
      taskRow('Due.md', '- [ ] Whenever', 7),
      taskRow('Due.md', '- [ ] Other space [deadline:: 2026-10-04]', 0, { space: 'Work' }),
    ]
    const space = due[0]?.space ?? ''
    expect(keyed(answer(builtinView('todos', { space }), 0, due, context))).toEqual([
      ['overdue', ['Late']],
      ['today', ['Now']],
      ['tomorrow', ['Next first', 'Next']],
      ['later', ['Far']],
      [null, ['Whenever']],
    ])
    const every = answer(builtinView('todos'), 0, due, context)
    expect(every.groups.flatMap((group) => group.rows.map((row) => row.task?.text))).toContain(
      'Other space',
    )
  })

  test('Today: overdue first, then today, by priority and time; not started and done ones out', () => {
    expect(keyed(answer(builtinView('today'), 0, rows, context))).toEqual([
      [true, ['Renew passport', 'Vault due']],
      [false, ['Gym', 'Call the bank', 'Old date', 'Draft talk']],
    ])
  })

  test('Today with undated tasks: one with no day of its own is in it, as begun (#408)', () => {
    expect(keyed(answer(builtinView('today', { undated: true }), 0, rows, context))).toEqual([
      [true, ['Renew passport', 'Vault due']],
      [
        false,
        [
          'Gym',
          'Call the bank',
          'Old date',
          'Draft talk',
          'Fix the bug',
          'Ship it',
          'Elsewhere',
          'Vault later',
        ],
      ],
    ])
  })

  test('a Today a tab changed follows the setting, unless its filter is the reader’s own', () => {
    const laidOut = (base: ReturnType<typeof builtinView>) => ({
      ...base,
      views: base.views.map((view) => ({ ...view, type: 'board' })),
    })
    const off = laidOut(builtinView('today'))
    const on = laidOut(builtinView('today', { undated: true }))
    expect(todayAs(off, true)).toEqual(on)
    expect(todayAs(on, false)).toEqual(off)
    expect(todayAs(on, true)).toEqual(on)
    const own = { ...off, views: off.views.map((view) => ({ ...view, filters: 'task.mine' })) }
    expect(todayAs(own, true)).toEqual(own)
  })

  test('a Today a filter was added to still follows the setting (#2017)', () => {
    const narrowed = (base: ReturnType<typeof builtinView>) => ({
      ...base,
      views: base.views.map((view) => ({
        ...view,
        filters: { and: [view.filters ?? 'true', 'task.mine'] },
      })),
    })
    const off = narrowed(builtinView('today'))
    const on = narrowed(builtinView('today', { undated: true }))
    expect(todayAs(off, true)).toEqual(on)
    expect(todayAs(on, false)).toEqual(off)
  })

  test('Todos holds the tasks with no start date under Today where the setting says (#2017)', () => {
    const due = [
      taskRow('Due.md', '- [ ] Now [deadline:: 2026-10-04]', 0),
      taskRow('Due.md', '- [ ] Whenever', 1),
      taskRow('Due.md', '- [ ] Begun 🛫 2026-10-01', 2),
      taskRow('Due.md', '- [ ] Planned ⏳ 2026-10-01', 3),
      taskRow('Due.md', '- [ ] Far [deadline:: 2026-11-30]', 4),
    ]
    const on = builtinView('todos', { undated: true })
    expect(keyed(answer(on, 0, due, context))).toEqual([
      ['today', ['Now', 'Whenever']],
      ['later', ['Far']],
      [null, ['Begun', 'Planned']],
    ])
    const off = builtinView('todos')
    expect(keyed(answer(off, 0, due, context))).toEqual([
      ['today', ['Now']],
      ['later', ['Far']],
      [null, ['Whenever', 'Begun', 'Planned']],
    ])
    expect(whenAs(off, true)).toEqual(on)
    expect(whenAs(on, false)).toEqual(off)
    expect(readBase(writeBase(on))).toEqual(on)
    const aside = { ...off, formulas: { when: 'task.text', [WHEN_ASIDE]: off.formulas.when ?? '' } }
    expect(whenAs(aside, true).formulas).toEqual({
      when: 'task.text',
      [WHEN_ASIDE]: on.formulas.when,
    })
  })

  test('Upcoming: what is overdue, then by day from today, a start still to come on its day', () => {
    expect(keyed(answer(builtinView('upcoming'), 0, rows, context))).toEqual([
      ['overdue', ['Renew passport', 'Vault due']],
      [{ kind: 'date', iso: '2026-10-04' }, ['Old date', 'Gym', 'Call the bank', 'Draft talk']],
      [{ kind: 'date', iso: '2026-10-05' }, ['Review PR']],
      [{ kind: 'date', iso: '2026-10-06' }, ['Dentist']],
      [{ kind: 'date', iso: '2026-10-08' }, ['Vault later']],
      [{ kind: 'date', iso: '2026-10-10' }, ['Taxes']],
    ])
  })

  test('Upcoming: what is overdue is first even when its day is later than the rest', () => {
    const late = [
      taskRow('Late.md', '- [ ] Soon 🛫 2026-10-05', 0),
      taskRow('Late.md', '- [ ] Put off [deadline:: 2026-10-01] 🛫 2026-10-09', 1),
    ]
    expect(keyed(answer(builtinView('upcoming'), 0, late, context))).toEqual([
      ['overdue', ['Put off']],
      [{ kind: 'date', iso: '2026-10-05' }, ['Soon']],
    ])
  })

  test('Completed: done and cancelled, newest day first', () => {
    expect(keyed(answer(builtinView('logbook'), 0, rows, context))).toEqual([
      [{ kind: 'date', iso: '2026-10-03' }, ['Water']],
      [{ kind: 'date', iso: '2026-10-02' }, ['Gym old']],
    ])
  })

  test('Inbox: every space has its own, shown together', () => {
    const inbox = builtinView('inbox', {
      inboxes: [
        { space: 'Notes', path: 'Inbox.md' },
        { space: 'Work', path: 'Inbox.md' },
      ],
    })
    expect(keyed(answer(inbox, 0, rows, context))).toEqual([
      ['Notes', ['Call the bank', 'Renew passport', 'Old date', 'Draft talk']],
      ['Work', ['Elsewhere']],
    ])
  })

  test("a project: its tasks under its headings, in the note's order", () => {
    const project = builtinView('project', { note: { space: 'Notes', path: 'Errands.md' } })
    expect(project.views[0]?.name).toBe('Errands')
    expect(keyed(answer(project, 0, rows, context))).toEqual([
      ['Health', ['Gym', 'Dentist']],
      ['Admin', ['Taxes']],
      [null, ['Review PR', 'Fix the bug']],
    ])
  })

  test('a label: tasks and notes that carry the tag', () => {
    const label = builtinView('label', { tag: 'work' })
    const result = answer(label, 0, rows, context)
    expect(
      result.groups.map((group) => [
        group.key,
        group.rows.map((row) => row.task?.text ?? row.file.basename),
      ]),
    ).toEqual([
      ['Notes//Errands.md', ['Fix the bug']],
      ['Notes//Projects/Thesis.md', ['Thesis']],
      ['Work//Work.md', ['Ship it']],
    ])
  })

  test('assigned to me', () => {
    expect(
      answer(builtinView('assigned'), 0, rows, context).groups[0]?.rows.map(
        (row) => row.task?.text,
      ),
    ).toEqual(['Fix the bug'])
  })

  test('each one copies to a base file that reads back the same', () => {
    for (const name of [
      'inbox',
      'today',
      'upcoming',
      'logbook',
      'project',
      'label',
      'assigned',
    ] as const) {
      const base = builtinView(name, {
        tag: 'x',
        note: { space: 'S', path: 'N.md' },
        inboxes: [{ space: 'S', path: 'Inbox.md' }],
      })
      expect(readBase(writeBase(base))).toEqual(base)
    }
    const undated = builtinView('today', { undated: true })
    expect(readBase(writeBase(undated))).toEqual(undated)
  })
})

describe('a list grouped by labels', () => {
  test('holds a task under each of its labels, and one with none under no value', () => {
    const tagged = [
      taskRow('Tags.md', '- [ ] Both #home #work', 0),
      taskRow('Tags.md', '- [ ] Home #home', 1),
      taskRow('Tags.md', '- [ ] Bare', 2),
    ]
    const base = builtinView('todos')
    const view = base.views[0]
    if (!view) throw new Error('no view')
    const byTag = {
      ...base,
      views: [
        {
          ...view,
          groupBy: { property: 'task.tags', direction: 'ASC' as const },
          orden: { ...view.orden, groups: [] },
        },
      ],
    }
    expect(keyed(answer(byTag, 0, tagged, context))).toEqual([
      ['home', ['Both', 'Home']],
      ['work', ['Both']],
      [null, ['Bare']],
    ])
  })
})
