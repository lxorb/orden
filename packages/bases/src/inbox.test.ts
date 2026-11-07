import { describe, expect, test } from 'vitest'
import { carriedOwn, INBOX_PATH, markedInbox, withTasksOf } from './inbox'
import { rowsOfText } from './note-rows'

describe("the space's own inbox", () => {
  test('is a hidden note at the root, the one hidden path sync carries', () => {
    expect(INBOX_PATH).toBe('.Inbox.md')
    expect(carriedOwn('.Inbox.md')).toBe(true)
    expect(carriedOwn('/.Inbox.md')).toBe(true)
    expect(carriedOwn('Inbox.md')).toBe(false)
    expect(carriedOwn('Work/.Inbox.md')).toBe(false)
    expect(carriedOwn('.obsidian/app.json')).toBe(false)
  })

  test('has its tasks as rows named Inbox, and no row of its own', () => {
    const rows = rowsOfText('Work', INBOX_PATH, '- [ ] Call the bank\n- [x] Post it\n')
    expect(rows.map((row) => row.kind)).toEqual(['task', 'task'])
    expect(rows.map((row) => [row.path, row.file.basename, row.file.name])).toEqual([
      ['.Inbox.md', 'Inbox', 'Inbox.md'],
      ['.Inbox.md', 'Inbox', 'Inbox.md'],
    ])
    expect(rowsOfText('Work', 'Inbox.md', '- [ ] x\n').map((row) => row.kind)).toEqual([
      'note',
      'task',
    ])
  })
})

describe('the inbox a space chose', () => {
  test('is the note marked so, the first by path when two are, never the own one', () => {
    expect(markedInbox([])).toBeNull()
    expect(
      markedInbox([
        ['Work.md', { 'todo-list': 'yes' }],
        ['Todoist/Inbox.md', { inbox: 'yes' }],
        ['Inbox.md', { inbox: 'yes', 'todo-list': 'yes' }],
        ['.Inbox.md', { inbox: 'yes' }],
        ['Gone.md', null],
      ]),
    ).toBe('Inbox.md')
    expect(markedInbox([['.Inbox.md', { inbox: 'yes' }]])).toBeNull()
  })
})

describe('two lists of tasks as one', () => {
  test('keeps every task of both, each once, sub-lines with their task', () => {
    const own = '- [ ] Call the bank\n'
    const old =
      '- [ ] Call the bank\n- [ ] Buy milk\n  - [ ] oat\n  a note under it\n\n- [x] Done 📅 2026-10-01\n'
    expect(withTasksOf(own, old)).toBe(
      '- [ ] Call the bank\n- [ ] Buy milk\n  - [ ] oat\n  a note under it\n- [x] Done 📅 2026-10-01\n',
    )
  })

  test('adds nothing asked again, and keeps a task written twice on purpose twice', () => {
    const old = '- [ ] Water the plants\n- [ ] Water the plants\n'
    const once = withTasksOf('', old)
    expect(once).toBe(old)
    expect(withTasksOf(once, old)).toBe(once)
    expect(withTasksOf(withTasksOf(once, old), old)).toBe(once)
  })

  test('is what it was where there is nothing to add', () => {
    expect(withTasksOf('- [ ] a', '')).toBe('- [ ] a')
    expect(withTasksOf('', '')).toBe('')
  })
})
