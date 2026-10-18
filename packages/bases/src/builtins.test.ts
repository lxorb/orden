import { describe, expect, test } from 'vitest'
import { answer } from './answer'
import { readBase, writeBase } from './base-file'
import { builtinView } from './builtins'
import { contextAt, noteRow, taskRow } from './fixtures/rows'
import type { Answer, Row } from './types'

const context = contextAt()
const keyed = (result: Answer) =>
  result.groups.map((group) => [group.key, group.rows.map((row) => row.task?.text)])

// Today is 2026-10-04 (contextAt). A start date is `🛫`, a deadline `[deadline:: ]`; a
// `📅` is a start date in a space of nib's own and a deadline in an Obsidian vault (#371).
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
  test('Today: overdue first, then today, by priority and time; not started and done ones out', () => {
    expect(keyed(answer(builtinView('today'), 0, rows, context))).toEqual([
      // Overdue is a deadline past: nib's own, or a vault's `📅`.
      [true, ['Renew passport', 'Vault due']],
      // A start date come stays in Today, and is never overdue: an old `📅` included.
      [false, ['Gym', 'Call the bank', 'Old date', 'Draft talk']],
    ])
  })

  test('Today with undated tasks: one with no day of its own is in it, as begun (#408)', () => {
    expect(keyed(answer(builtinView('today', { undated: true }), 0, rows, context))).toEqual([
      [true, ['Renew passport', 'Vault due']],
      // No start date and no day scheduled: in, whatever its deadline says, which still
      // only makes it overdue once past. One whose start is still to come stays out.
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

  test('Upcoming: what is overdue, then by day from today, a start still to come on its day', () => {
    expect(keyed(answer(builtinView('upcoming'), 0, rows, context))).toEqual([
      ['overdue', ['Renew passport', 'Vault due']],
      // Started already: today, which is when it can be done.
      [{ kind: 'date', iso: '2026-10-04' }, ['Old date', 'Gym', 'Call the bank', 'Draft talk']],
      [{ kind: 'date', iso: '2026-10-05' }, ['Review PR']],
      [{ kind: 'date', iso: '2026-10-06' }, ['Dentist']],
      [{ kind: 'date', iso: '2026-10-08' }, ['Vault later']],
      [{ kind: 'date', iso: '2026-10-10' }, ['Taxes']],
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
      // A project is its note: what has not started is there too.
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
      // Review PR starts tomorrow.
      ['Errands', ['Fix the bug']],
      ['Thesis', ['Thesis']],
      ['Work', ['Ship it']],
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
  })
})
