import type { Row } from '@orden/bases'
import { expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({ workspace: { spaces: [] } }))
const { askOf, keptOut, lastWords } = await import('./do-task')

const row = { space: 'Home', path: 'Errands.md', anchor: { line: 3, hash: 'abc' } } as Row

test('a task done with AI is handed over with its words and where update_task ticks it', () => {
  const asked = askOf(row, 'Book the dentist')
  expect(asked).toContain('update_task (done: true)')
  expect(asked).toContain(
    'Task: Book the dentist\nSpace: Home\nNote: Errands.md\nAt: Errands.md#3:abc',
  )
})

test('a task it cannot finish is left open, asked about in a comment, and flagged', () => {
  const asked = askOf(row, 'Book the dentist')
  expect(asked).toContain('with a comment that says what you need')
  expect(asked).toContain('"needs-input"')
})

test('the reader’s own words replace what it is asked to do, not how it leaves the task', () => {
  const asked = askOf(row, 'Book the dentist', 'Only plan it; do not book anything.')
  expect(asked.startsWith('Only plan it; do not book anything.\n\n')).toBe(true)
  expect(asked).not.toContain('Do this task from my notes for me.')
  expect(asked).toContain('"needs-input"')
  expect(askOf(row, 'Book the dentist', '  ')).toContain('Do this task from my notes for me.')
})

test('a switch turned off keeps its tools out, and never the task’s own note or the task', () => {
  expect(keptOut([])).toEqual([])
  const browser = keptOut(['browser'])
  expect(browser).toContain('browser_navigate')
  expect(browser.every((one) => one.startsWith('browser_'))).toBe(true)

  const notes = keptOut(['notes'])
  expect(notes).toContain('search_notes')
  expect(notes).not.toContain('write_note')

  const edits = keptOut(['edits'])
  expect(edits).toEqual(expect.arrayContaining(['write_note', 'edit_note', 'trash_file']))
  expect(edits).not.toContain('search_notes')

  const all = keptOut(['browser', 'notes', 'edits'])
  for (const own of ['read_note', 'list_tasks', 'update_task']) expect(all).not.toContain(own)
})

test('it is told a reply in the chat alone is never read', () => {
  expect(askOf(row, 'Book the dentist')).toContain(
    'Always end with one of these two update_task calls',
  )
})

test('the chat’s last words are its last text, whatever it called after', () => {
  expect(lastWords(null)).toBe('')
  const turn = {
    id: 't',
    role: 'model',
    parts: [
      { kind: 'text', text: 'Reading it.' },
      { kind: 'tool', id: 'c', verb: 'read_note', args: {}, state: 'ok' },
      { kind: 'text', text: ' Which landlord? \n' },
    ],
  } as unknown as Parameters<typeof lastWords>[0]
  expect(lastWords(turn)).toBe('Which landlord?')
})
