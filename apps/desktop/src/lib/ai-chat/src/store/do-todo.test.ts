import { describe, expect, test } from 'vitest'
import type { Todo } from '../../../tasks-model/src/api'
import { AGENT_WINDOW_VERBS } from '../../../agent-protocol/src/api'
import { askOf, reachOf } from './do-todo'

const todo: Todo = {
  id: 'tabc',
  title: 'Book the train',
  description: 'Before Friday',
  labels: [],
  space: null,
  start: null,
  deadline: '2026-11-21',
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [{ id: 's1', title: 'Pick a seat', done: true }],
  order: 1,
  created: 1,
}
describe('a todo done with AI', () => {
  test('is asked by its id, with what it holds, and ends with update_task on that id', () => {
    const asked = askOf(todo, '')
    expect(asked).toContain('Do this todo for me.')
    expect(asked).toContain('Id: tabc')
    expect(asked).toContain('Description: Before Friday')
    expect(asked).toContain('Deadline: 2026-11-21')
    expect(asked).toContain('[x] Pick a seat')
    expect(asked).toContain('update_task')
    expect(askOf(todo, 'Just do it.').startsWith('Just do it.')).toBe(true)
  })
  test('may use only update_task and list_tasks, and the groups that are turned on', () => {
    expect(reachOf([])).toEqual(['update_task', 'list_tasks'])
    const browser = reachOf(['browser'])
    expect(browser.some((one) => one.startsWith('browser_'))).toBe(true)
    expect(browser).not.toContain('read_note')
    const notes = reachOf(['notes'])
    expect(notes).toContain('read_note')
    expect(notes.some((one) => one.startsWith('browser_'))).toBe(false)
    expect(notes).not.toContain('edit_note')
    expect(reachOf(['edits'])).toContain('edit_note')
  })
  test('never reaches the terminal, files, processes, http or the reader’s own context, even with every group on', () => {
    const all = reachOf(['browser', 'notes', 'edits'])
    const never = Object.entries(AGENT_WINDOW_VERBS)
      .filter(([, scope]) => ['terminal', 'files', 'process', 'http', 'context'].includes(String(scope)))
      .map(([verb]) => verb)
    expect(never.length).toBeGreaterThan(0)
    for (const verb of [...never, 'run_command', 'files', 'process', 'http', 'run_agent'])
      expect(all).not.toContain(verb)
  })
})
