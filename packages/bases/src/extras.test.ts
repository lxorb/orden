/** Lane 7's engine: ids, automations, templates, colour, buttons and CSV. */

import { describe, expect, test } from 'vitest'
import { fired, inBase, readAutomations, withAutomations } from './automations'
import { readBase, writeBase } from './base-file'
import { pressed, readButtons, withButton } from './buttons'
import { colourExpression, colourRules } from './colour'
import { csvText, csvValue } from './csv'
import { contextAt, noteRow } from './fixtures/rows'
import { idNumber, idRepairs, idText, nextId } from './ids'
import { fillTemplate, repeatDue, withoutTemplateKeys } from './templates'
import type { Row } from './types'

const day = (iso: string) => new Date(`${iso}T09:00:00`).getTime()

describe('unique ids', () => {
  const bugs = [
    noteRow('Bugs/A.md', 'id: BUG-1', { ctime: day('2026-01-01') }),
    noteRow('Bugs/B.md', 'id: BUG-7', { ctime: day('2026-02-01') }),
    noteRow('Bugs/C.md', 'id: bug-3', { ctime: day('2026-03-01') }),
  ]

  test('the next is one past the highest, whatever case the prefix was written in', () => {
    expect(nextId(bugs, 'id', 'BUG')).toBe('BUG-8')
    expect(nextId([], 'id', 'BUG')).toBe('BUG-1')
    expect(nextId([noteRow('A.md', 'n: 4')], 'n', '')).toBe('5')
    expect(idNumber('BUG-12', 'BUG')).toBe(12)
    expect(idNumber('TASK-12', 'BUG')).toBeNull()
    expect(idText('', 3)).toBe('3')
  })

  test('two devices offline both made 8: one becomes 9, and both agree', () => {
    const older = noteRow('Bugs/Older.md', 'id: BUG-8', { ctime: day('2026-04-01') })
    const younger = noteRow('Bugs/Younger.md', 'id: BUG-8', { ctime: day('2026-04-02') })
    const repairs = idRepairs([...bugs, younger, older], 'id', 'BUG', false)
    expect(repairs.map((one) => [one.row.path, one.id])).toEqual([['Bugs/Younger.md', 'BUG-9']])
    expect(idRepairs([...bugs, older, younger], 'id', 'BUG', false)).toEqual(repairs)
  })

  test('two devices that disagree on when the rows were made renumber the same one, and settle', () => {
    // ctime is each disk's own birth time, which sync does not carry: A made X and B
    // made Y offline, so each device thinks the other's note is the younger.
    const paths = ['Bugs/X.md', 'Bugs/Y.md', 'Bugs/Z.md']
    const ctimes = {
      A: { 'Bugs/X.md': 1, 'Bugs/Y.md': 3, 'Bugs/Z.md': 5 },
      B: { 'Bugs/X.md': 4, 'Bugs/Y.md': 2, 'Bugs/Z.md': 6 },
    }
    // What has synced: every note's id, the same on both devices.
    let ids: Record<string, string> = Object.fromEntries(paths.map((path) => [path, 'BUG-45']))
    const seenOn = (device: 'A' | 'B') => [
      ...bugs,
      ...paths.map((path) =>
        noteRow(path, { id: ids[path] ?? '' }, { ctime: ctimes[device][path as 'Bugs/X.md'] }),
      ),
    ]

    for (let round = 0; round < 3; round++) {
      const a = idRepairs(seenOn('A'), 'id', 'BUG', false)
      const b = idRepairs(seenOn('B'), 'id', 'BUG', false)
      expect(a.map((one) => [one.row.path, one.id])).toEqual(b.map((one) => [one.row.path, one.id]))
      // Each device writes its repairs; the sync then carries both.
      const next = { ...ids }
      for (const one of [...a, ...b]) next[one.row.path] = one.id
      ids = next
    }
    const held = paths.map((path) => ids[path])
    expect(new Set(held).size).toBe(paths.length)
    expect(idRepairs(seenOn('A'), 'id', 'BUG', false)).toEqual([])
    expect(idRepairs(seenOn('B'), 'id', 'BUG', false)).toEqual([])
  })

  test('a duplicate is renumbered, not the note it was copied from', () => {
    const repairs = idRepairs(
      [
        noteRow('Bugs/Crash.md', 'id: BUG-45', { ctime: 1 }),
        noteRow('Bugs/Crash copy.md', 'id: BUG-45', { ctime: 9 }),
        noteRow('Bugs/Crash 2.md', 'id: BUG-45', { ctime: 9 }),
      ],
      'id',
      'BUG',
      false,
    )
    expect(repairs.map((one) => [one.row.path, one.id])).toEqual([
      ['Bugs/Crash 2.md', 'BUG-46'],
      ['Bugs/Crash copy.md', 'BUG-47'],
    ])
  })

  test('devices that spell a name differently on disk still pick the same twin', () => {
    // A `:` is `_` on a Mac and on Windows, and a Mac may hold a name decomposed.
    const spelled = {
      linux: { X: 'Bugs/Meeting: Q3.md', Y: 'Bugs/MeetingA.md', Z: 'Bugs/\u00dcbel.md' },
      mac: { X: 'Bugs/Meeting_ Q3.md', Y: 'Bugs/MeetingA.md', Z: 'Bugs/U\u0308bel.md' },
    }
    let ids: Record<string, string> = { X: 'BUG-45', Y: 'BUG-45', Z: 'BUG-45' }
    const seenOn = (device: 'linux' | 'mac') =>
      (['X', 'Y', 'Z'] as const).map((note) =>
        noteRow(spelled[device][note], { id: ids[note] ?? '' }, { ctime: 1 }),
      )
    const noteOf = (device: 'linux' | 'mac', path: string) =>
      (['X', 'Y', 'Z'] as const).find((note) => spelled[device][note] === path)

    for (let round = 0; round < 3; round++) {
      const linux = idRepairs(seenOn('linux'), 'id', 'BUG', false)
      const mac = idRepairs(seenOn('mac'), 'id', 'BUG', false)
      const named = (device: 'linux' | 'mac', out: typeof linux) =>
        out.map((one) => [noteOf(device, one.row.path), one.id])
      expect(named('linux', linux)).toEqual(named('mac', mac))
      const next = { ...ids }
      for (const [note, id] of [...named('linux', linux), ...named('mac', mac)])
        if (note && id) next[note] = id
      ids = next
    }
    expect(new Set(Object.values(ids)).size).toBe(3)
  })

  test('turned on, every row without one is numbered in the order they were made', () => {
    const rows = [
      noteRow('Bugs/Late.md', '', { ctime: day('2026-05-02') }),
      noteRow('Bugs/Early.md', '', { ctime: day('2026-05-01') }),
      ...bugs,
    ]
    expect(idRepairs(rows, 'id', 'BUG').map((one) => [one.row.path, one.id])).toEqual([
      ['Bugs/Early.md', 'BUG-8'],
      ['Bugs/Late.md', 'BUG-9'],
    ])
    expect(idRepairs(rows, 'id', 'BUG', false)).toEqual([])
  })
})

describe('automations', () => {
  const base = readBase(`filters:
  and:
    - file.inFolder("Bugs")
nib:
  automations:
    - when: { property: status, is: Done }
      set: { finished: "{{date}}", owner: "" }
      move: Bugs/Done
    - when: { property: status }
      notify: "{{title}} moved"
    - when: added
      set: { status: To do }
    - when: { property: priority, is: high }
      notify: Look
      off: true
    - not an automation
`)
  const automations = readAutomations(base)
  const filling = { today: '2026-10-05', time: '09:30' }
  const was = noteRow('Bugs/Crash.md', 'status: Doing\nowner: Emil\npriority: low')
  const done = noteRow('Bugs/Crash.md', 'status: Done\nowner: Emil\npriority: high')

  test('reads every one that is one, in order', () => {
    expect(automations.map((one) => one.when)).toEqual([
      { property: 'status', is: 'Done' },
      { property: 'status' },
      { added: true },
      { property: 'priority', is: 'high' },
    ])
  })

  test('a change fires what waits for it, together, as one effect', () => {
    expect(fired(automations, was, done, filling)).toEqual({
      set: { finished: { kind: 'date', iso: '2026-10-05' }, owner: null },
      move: 'Bugs/Done',
      notify: ['Crash moved'],
    })
  })

  test('fires once per change: an edit to a row already Done fires nothing', () => {
    const renamed = noteRow('Bugs/Crash.md', 'status: Done\nowner: Lucile\npriority: high')
    expect(fired(automations, done, renamed, filling)).toBeNull()
    // Looking again at the same row is no change at all.
    expect(fired(automations, done, done, filling)).toBeNull()
  })

  test('an added row fires what waits for one, and nothing that waits for a change', () => {
    expect(fired(automations, undefined, done, filling)).toEqual({
      set: { status: 'To do' },
      notify: [],
    })
  })

  test('a switched-off one never fires; a task row never fires', () => {
    const low = noteRow('Bugs/Crash.md', 'status: Done\npriority: low')
    expect(fired(automations, low, done, filling)).toBeNull()
    const task = { ...done, kind: 'task' } as Row
    expect(fired(automations, was, task, filling)).toBeNull()
  })

  test('the effect is one change, so the edit it rides with is one undo', () => {
    const effect = fired(automations, was, done, filling)
    expect(Object.keys(effect?.set ?? {})).toEqual(['finished', 'owner'])
  })

  test('only the base own rows are its rows', () => {
    expect(inBase(base, done, contextAt())).toBe(true)
    expect(inBase(base, noteRow('Films/Heat.md'), contextAt())).toBe(false)
  })

  test('written back with every key it did not know kept', () => {
    const next = withAutomations(base, automations.slice(0, 1))
    const written = writeBase(next, '')
    expect(readAutomations(readBase(written))).toEqual(automations.slice(0, 1))
    expect(withAutomations(base, []).nib.kept.automations).toBeUndefined()
  })
})

describe('templates', () => {
  const filling = { title: 'Weekly review', today: '2026-10-05', time: '09:30' }

  test("Obsidian's placeholders, and dates relative to today", () => {
    expect(
      fillTemplate(
        '# {{title}}\n{{date}} {{time}} {{date:dddd D MMMM}} {{ date+7d }} {{date-1w:YYYY/MM/DD}} {{date+1M}} {{other}}',
        filling,
      ),
    ).toBe(
      '# Weekly review\n2026-10-05 09:30 Monday 5 October 2026-10-12 2026/09/28 2026-11-05 {{other}}',
    )
  })

  test("a template's own keys never reach the note", () => {
    expect(
      withoutTemplateKeys(
        '---\nrepeat: every Monday\nmade: 2026-09-28\ntags: [review]\n---\n# x\n',
      ),
    ).toBe('---\ntags: [review]\n---\n# x\n')
    expect(withoutTemplateKeys('---\nrepeat: every day\n---\n# x\n')).toBe('# x\n')
  })

  test('a repeating template owes one note for a missed stretch, listing what it missed', () => {
    const weekly = {
      repeat: 'every week on Monday',
      made: { kind: 'date' as const, iso: '2026-09-14' },
    }
    expect(repeatDue(weekly, '2026-10-05')).toEqual({
      day: '2026-10-05',
      missed: ['2026-09-21', '2026-09-28'],
    })
    expect(repeatDue({ ...weekly, made: '2026-10-05' }, '2026-10-07')).toBeNull()
    expect(repeatDue({ repeat: 'every day' }, '2026-10-05')).toEqual({
      day: '2026-10-05',
      missed: [],
    })
    expect(repeatDue({ repeat: 'whenever' }, '2026-10-05')).toBeNull()
  })
})

describe('conditional colour', () => {
  test('rules are written as nested ifs and read back', () => {
    const rules = [
      { when: 'status == "Done"', tone: 'success' },
      { when: 'due < today() && list(tags).contains("a, b")', tone: 'danger' },
    ]
    const written = colourExpression(rules)
    expect(written).toBe(
      'if(status == "Done", "success", if(due < today() && list(tags).contains("a, b"), "danger", null))',
    )
    expect(colourRules(written)).toEqual(rules)
    expect(colourExpression([])).toBeUndefined()
    expect(colourRules(undefined)).toEqual([])
    expect(colourRules('if(a, b, null)')).toBeNull()
    expect(colourRules('"danger"')).toBeNull()
  })
})

describe('buttons', () => {
  const base = readBase(`nib:
  buttons:
    Done:
      set: { status: Done, finished: "{{date}}", owner: "" }
      colour: green
    Follow up:
      task: "Call about {{title}}"
      command: app.tasks
      open: "https://example.com/{{title}}"
`)

  test('a press sets its row and says what else to do', () => {
    const [done, follow] = readButtons(base)
    const filling = { title: 'Crash', today: '2026-10-05', time: '09:30' }
    expect(done && pressed(done, filling)).toEqual({
      set: { status: 'Done', finished: { kind: 'date', iso: '2026-10-05' }, owner: null },
    })
    expect(follow && pressed(follow, filling)).toEqual({
      set: {},
      task: 'Call about Crash',
      command: 'app.tasks',
      open: 'https://example.com/Crash',
    })
  })

  test('made, changed and taken away, keys it does not know kept', () => {
    const [done] = readButtons(base)
    if (!done) throw new Error('no button')
    const changed = withButton(base, 'Done', { ...done, set: { status: 'Shipped' } })
    expect(readButtons(readBase(writeBase(changed)))[0]).toEqual({
      ...done,
      set: { status: 'Shipped' },
    })
    expect(readButtons(withButton(base, 'Done', null)).map((one) => one.name)).toEqual([
      'Follow up',
    ])
  })
})

describe('CSV', () => {
  test('cells a spreadsheet reads, quoted where they must be', () => {
    expect(csvValue({ kind: 'date', iso: '2026-10-06', time: '16:00:00' })).toBe('2026-10-06 16:00')
    expect(csvValue({ kind: 'link', target: 'Projects/Thesis.md' })).toBe('Thesis')
    expect(csvValue(['a', 'b', null])).toBe('a, b')
    expect(csvValue(true)).toBe('true')
    expect(csvText(['Name', 'Note'], [['Dune', 'a "classic", long\nread']])).toBe(
      'Name,Note\r\nDune,"a ""classic"", long\nread"\r\n',
    )
  })
})

describe('the view keys lane 7 adds', () => {
  test('round-trip, and a file that says them gives itself back', () => {
    const yaml = `views:
  - type: table
    name: All
    nib:
      lines: 2
      freeze: 1
      template: "[[Templates/Bug]]"
      required:
        - status
      colour: 'if(status == "Done", "success", null)'
`
    const base = readBase(yaml)
    expect(base.views[0]?.nib).toMatchObject({
      lines: 2,
      freeze: 1,
      template: '[[Templates/Bug]]',
      required: ['status'],
    })
    expect(writeBase(base, yaml)).toBe(yaml)
  })
})
