import { readBase, type Row } from '@orden/bases'
import { rowsOf } from '@orden/bases/rows'
import { scanRows } from '@orden/bases/scan'
import { scanNote } from '@orden/scan/note'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { type RowChange, changed } from '../../rows/src/api'
import Cell from './Cell.svelte'

const TABLE = 'views:\n  - type: table\n'

function rowOf(path: string, text: string, kind: Row['kind'] = 'note'): Row {
  const rows = rowsOf('Notes', { ...scanNote(path, text), ...scanRows(text), stamp: null })
  const found = rows.find((row) => row.kind === kind)
  if (!found) throw new Error(`no row in ${text}`)
  return found
}

const unmounts: (() => void)[] = []

afterEach(() => {
  for (const done of unmounts.splice(0)) done()
})

function shown(
  row: Row,
  property: string,
  editor: string,
  { editing = true, base = TABLE }: { editing?: boolean; base?: string } = {},
) {
  const target = document.createElement('div')
  document.body.append(target)
  const writes: RowChange[] = []
  const kit = {
    live: {
      base: readBase(base),
      today: '2026-11-15',
      context: { today: '2026-11-15', now: '2026-11-15T10:00:00', me: 'Emil' },
      rows: [row],
    },
    writes: () => true,
    write: (_row: Row, change: RowChange) => void writes.push(change),
    press: () => undefined,
  }
  const cell = mount(Cell, { target, props: { row, property, editor, kit, editing } as never })
  unmounts.push(() => {
    void unmount(cell)
    target.remove()
  })
  flushSync()
  return { target, writes }
}

function typed(target: HTMLElement, words: string) {
  const field = target.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')
  if (!field) throw new Error('no field')
  field.value = words
  field.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

function taskEdited(line: string, property: string, editor: string, words: string) {
  const text = `${line}\n`
  const row = rowOf('a.md', text, 'task')
  const { target, writes } = shown(row, property, editor)
  typed(target, words)
  return {
    target,
    writes,
    after: writes[0] ? changed(text, row, writes[0]) : text,
    ticked: changed(text, row, { task: { done: true } }),
  }
}

describe('a task cell, when edited', () => {
  test.each([
    ['task.due', '- [ ] buy milk 📅 2026-12-01'],
    ['task.scheduled', '- [ ] buy milk ⏳ 2026-12-01 📅 2026-11-20'],
  ])('writes the day picked for %s', (property, expected) => {
    const { after } = taskEdited('- [ ] buy milk 📅 2026-11-20', property, 'date', '2026-12-01')
    expect(after).toBe(`${expected}\n`)
  })

  test('writes the duration typed', () => {
    const { after } = taskEdited(
      '- [ ] buy milk [duration:: 30m]',
      'task.duration',
      'duration',
      '1h',
    )
    expect(after).toBe('- [ ] buy milk [duration:: 1h]\n')
  })

  test('leaves the duration alone when what is shown is written back', () => {
    const line = '- [ ] buy milk [duration:: 1h30m]'
    const row = rowOf('a.md', `${line}\n`, 'task')
    const { target, writes } = shown(row, 'task.duration', 'duration')
    const field = target.querySelector('input')
    typed(target, field?.value ?? '')
    const after = writes[0] ? changed(`${line}\n`, row, writes[0]) : `${line}\n`
    expect(after).toBe(`${line}\n`)
  })

  test.each(['Done', 'done', 'x'])('ticks the task the way its checkbox does for %s', (words) => {
    const { after, ticked } = taskEdited(
      '- [ ] buy milk 📅 2026-11-20',
      'task.status',
      'status',
      words,
    )
    expect(ticked).toMatch(/^- \[x\] buy milk/)
    expect(after).toBe(ticked)
  })

  test('ticks a repeating task through to its next occurrence', () => {
    const { after, ticked } = taskEdited(
      '- [ ] water plants 🔁 every day 📅 2026-11-20',
      'task.status',
      'status',
      'Done',
    )
    expect(ticked?.split('\n').filter(Boolean)).toHaveLength(2)
    expect(after).toBe(ticked)
  })

  test('unticks a done task the way its checkbox does', () => {
    const line = '- [x] buy milk ✅ 2026-11-10'
    const row = rowOf('a.md', `${line}\n`, 'task')
    const { target, writes } = shown(row, 'task.status', 'status')
    typed(target, 'To do')
    expect(writes[0] ? changed(`${line}\n`, row, writes[0]) : null).toBe(
      changed(`${line}\n`, row, { task: { done: false } }),
    )
  })

  test('writes nothing for words that are not a status', () => {
    const { writes, after } = taskEdited('- [ ] buy milk', 'task.status', 'status', 'nope')
    expect(writes).toEqual([])
    expect(after).toBe('- [ ] buy milk\n')
  })

  test.each([
    ['high', '- [ ] buy milk ⏫'],
    ['2', '- [ ] buy milk ⏫'],
    ['lowest', '- [ ] buy milk ⏬'],
  ])('writes the priority %s', (words, expected) => {
    const { after } = taskEdited('- [ ] buy milk', 'task.priority', 'priority', words)
    expect(after).toBe(`${expected}\n`)
  })

  test('writes nothing for words that are not a priority', () => {
    const { writes } = taskEdited('- [ ] buy milk', 'task.priority', 'priority', 'soon')
    expect(writes).toEqual([])
  })
})

test('a checkbox cell on a note without the key shows a box unticked that writes the key when ticked', () => {
  const { target, writes } = shown(rowOf('b.md', 'words\n'), 'note.done', 'checkbox', {
    editing: false,
  })
  const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  expect(box?.checked).toBe(false)
  box?.click()
  flushSync()
  expect(writes).toEqual([{ note: { done: true } }])
})

describe('a number cell, when edited', () => {
  test.each([
    ['1500', '1500'],
    ['3.14159', '3.14159'],
  ])('opens holding %s', (said, expected) => {
    const { target } = shown(rowOf('c.md', `---\nprice: ${said}\n---\n`), 'note.price', 'number')
    expect(target.querySelector('input')?.value).toBe(expected)
  })
})

describe('a select cell, when an option is picked', () => {
  const numbered = `${TABLE}orden:\n  properties:\n    priority:\n      options: [1, 2, 3]\n`

  test('writes a number where the property holds numbers', () => {
    const { target, writes } = shown(
      rowOf('d.md', '---\npriority: 1\n---\n'),
      'note.priority',
      'select',
      {
        base: numbered,
      },
    )
    typed(target, '3')
    expect(writes).toEqual([{ note: { priority: 3 } }])
  })

  test('writes a number where the note has none and every option is a number', () => {
    const { target, writes } = shown(rowOf('d.md', 'words\n'), 'note.priority', 'select', {
      base: numbered,
    })
    typed(target, '2')
    expect(writes).toEqual([{ note: { priority: 2 } }])
  })

  test('keeps words that only look like numbers as words', () => {
    const { target, writes } = shown(
      rowOf('e.md', "---\nzip: '007'\n---\n"),
      'note.zip',
      'select',
      {
        base: `${TABLE}orden:\n  properties:\n    zip:\n      options: ['007', '008']\n`,
      },
    )
    typed(target, '008')
    expect(writes).toEqual([{ note: { zip: '008' } }])
  })

  test('keeps words where the property holds words', () => {
    const { target, writes } = shown(
      rowOf('f.md', "---\nrank: '1'\n---\n"),
      'note.rank',
      'select',
      {
        base: `${TABLE}orden:\n  properties:\n    rank:\n      options: [1, 2]\n`,
      },
    )
    typed(target, '2')
    expect(writes).toEqual([{ note: { rank: '2' } }])
  })
})
