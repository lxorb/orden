import { describe, expect, test } from 'vitest'
import { carriedOwn, INBOX_PATH, withTasksOf } from './inbox'
import { rowsOfText } from './note-rows'

/** The space's own inbox (#1044): a hidden note whose tasks are rows named Inbox, the
 *  one hidden file sync carries, and two lists of tasks merged without losing one. */

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
    // A note of the reader's is a row as ever.
    expect(rowsOfText('Work', 'Inbox.md', '- [ ] x\n').map((row) => row.kind)).toEqual([
      'note',
      'task',
    ])
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
