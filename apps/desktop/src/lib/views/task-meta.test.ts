import { INBOX_PATH, type Row } from '@orden/bases'
import { taskRowsOfText } from '@orden/bases/tasks'
import { describe, expect, test } from 'vitest'
import { accentColour } from '../accents'
import {
  dayTone,
  hasMeta,
  labelColour,
  lineCount,
  metaOf,
  placeOf,
  subtaskCounts,
  taskKey,
} from './task-meta'

const TODAY = '2026-10-12'

function rows(text: string): Row[] {
  return taskRowsOfText('Notes', 'Errands.md', text)
}

describe('the meta line under a task', () => {
  test('a day is drawn in the colour of how near it is', () => {
    expect(
      ['2026-10-11', TODAY, '2026-10-13', '2026-10-18', '2026-10-19'].map((day) =>
        dayTone(day, TODAY),
      ),
    ).toEqual(['late', 'today', 'tomorrow', 'week', 'later'])
  })

  test('says the day, the deadline, the duration, a reminder, the labels, in order', () => {
    const [task] = rows(
      '- [ ] Call [time:: 16:00] [duration:: 45m] [deadline:: 2026-10-14] [remind:: 15m] #admin 🔁 every week 📅 2026-10-13\n',
    ).map((row) => row.task)
    if (!task) throw new Error('no task')
    const meta = metaOf(task, TODAY, true, undefined)
    expect(meta.map((one) => one.kind)).toEqual(['date', 'deadline', 'duration', 'remind', 'tag'])
    expect(meta[0]).toMatchObject({ tone: 'tomorrow', repeat: true })
    expect(meta[1]).toMatchObject({ late: false })
  })

  test('a done task is in no hurry, and a day the group says is left off', () => {
    const [done, timed, started] = rows(
      '- [x] Old 📅 2026-10-20\n- [ ] Timed [time:: 09:30] 📅 2026-10-12\n- [ ] Begun 📅 2026-10-01\n',
    ).map((row) => row.task)
    if (!done || !timed || !started) throw new Error('no task')
    expect(metaOf(done, TODAY, true, undefined)[0]).toMatchObject({ tone: 'later' })
    expect(metaOf(started, TODAY, true, undefined)).toEqual([])
    expect(metaOf(timed, TODAY, false, undefined).map((one) => one.kind)).toEqual(['date'])
    expect(metaOf(timed, TODAY, false, undefined)[0]).toMatchObject({ repeat: false })
  })

  test('counts a task’s own sub-tasks, done and all, and not its grandchildren', () => {
    const all = rows(
      '- [ ] Move\n  - [x] Boxes\n  - [ ] Van\n    - [ ] Call the van\n  - [-] Never mind\n',
    )
    const counts = subtaskCounts(all)
    expect(counts.get(taskKey('Notes', 'Errands.md', 0))).toEqual({ done: 1, total: 2 })
    expect(counts.get(taskKey('Notes', 'Errands.md', 2))).toEqual({ done: 0, total: 1 })
  })

  test('says it has a meta line exactly where the meta line has something in it', () => {
    const all = rows(
      [
        '- [ ] a',
        '- [ ] b 📅 2026-10-13',
        '- [ ] c [time:: 09:00] 📅 2026-10-13',
        '- [ ] d 🔁 every day 📅 2026-10-13',
        '- [ ] e #tag',
        '- [ ] f [deadline:: 2026-10-20]',
        '- [ ] g',
        '  - one comment',
      ].join('\n'),
    )
    for (const row of all) {
      const task = row.task
      if (!task) continue
      for (const dated of [true, false]) {
        expect([task.text, dated, hasMeta(task, dated, undefined, TODAY)]).toEqual([
          task.text,
          dated,
          metaOf(task, TODAY, dated, undefined).length > 0,
        ])
      }
    }
  })

  test('a row is as many lines as it has things to say', () => {
    const [plain, described] = rows('- [ ] Plain\n- [ ] Described #a\n  Words under it.\n').map(
      (row) => row.task,
    )
    if (!plain || !described) throw new Error('no task')
    expect(lineCount(plain, hasMeta(plain, true, undefined, TODAY), false)).toBe(1)
    expect(lineCount(plain, false, true)).toBe(2)
    expect(lineCount(described, hasMeta(described, true, undefined, TODAY), false)).toBe(3)
  })

  test('a repeat is said once, on the start date to come, else on the deadline', () => {
    const [ahead, due, alone, timed] = rows(
      [
        '- [ ] Ahead [deadline:: 2026-10-20] 🔁 every week 📅 2026-10-14',
        '- [ ] Due [deadline:: 2026-10-12] 🔁 every week',
        '- [ ] Alone 🔁 every week',
        '- [ ] Timed [time:: 09:00] [deadline:: 2026-10-20] 🔁 every week',
      ].join('\n'),
    ).map((row) => row.task)
    if (!ahead || !due || !alone || !timed) throw new Error('no task')
    const repeats = (task: typeof ahead) =>
      metaOf(task, TODAY, true, undefined).flatMap((one) =>
        'repeat' in one ? [[one.kind, one.repeat]] : [],
      )
    expect(repeats(ahead)).toEqual([
      ['date', true],
      ['deadline', false],
    ])
    expect(repeats(due)).toEqual([['deadline', true]])
    expect(metaOf(due, TODAY, true, undefined)[0]).toMatchObject({ late: true })
    expect(repeats(alone)).toEqual([['date', true]])
    expect(repeats(timed)).toEqual([
      ['date', false],
      ['deadline', true],
    ])
  })
})

describe('where a card says its task lives', () => {
  test('the space’s own inbox is the Inbox, and a note its name and its heading', () => {
    const [inboxed] = taskRowsOfText('Notes', INBOX_PATH, '- [ ] Call\n')
    const [kept] = rows('# Errands\n## Shop\n- [ ] Milk\n')
    const [titled] = rows('# Errands\n- [ ] Bread\n')
    if (!inboxed || !kept || !titled) throw new Error('no task')
    expect(placeOf(inboxed)).toMatchObject({ inbox: true })
    expect(placeOf(kept)).toEqual({ inbox: false, name: 'Errands', section: 'Shop' })
    expect(placeOf(titled)).toEqual({ inbox: false, name: 'Errands', section: undefined })
  })
})

describe('a label’s colour on a card', () => {
  test('is its name’s, the same every time and in either case, and never the grey', () => {
    const names = ['admin', 'Orga', 'Routine', 'family', 'work', 'x', 'kestrel', 'ink', 'wind']
    for (const scheme of ['light', 'dark'] as const) {
      const slate = accentColour('slate', scheme)
      for (const name of names) {
        expect(labelColour(name, scheme)).toBe(labelColour(name.toUpperCase(), scheme))
        expect(labelColour(name, scheme)).not.toBe(slate)
      }
    }
    expect(new Set(names.map((name) => labelColour(name, 'light'))).size).toBeGreaterThan(3)
  })
})
