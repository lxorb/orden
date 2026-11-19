import { describe, expect, test } from 'vitest'
import type { Todo } from '../../../tasks-model/src/api'
import { askOf, keptOut } from './do-todo'

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
  test('leaves out the tools that are turned off, and never update_task', () => {
    expect(keptOut([])).toEqual([])
    const off = keptOut(['browser', 'notes', 'edits'])
    expect(off.some((one) => one.startsWith('browser_'))).toBe(true)
    expect(off).toContain('read_note')
    expect(off).not.toContain('update_task')
    expect(off).not.toContain('list_tasks')
  })
})
