import { describe, expect, test } from 'vitest'
import { taskAt } from './tasks'

/** The words of the task, which is what `marker` is for. */
const words = (line: string) => {
  const task = taskAt(line)
  return task ? line.slice(task.marker) : null
}

describe('a task item', () => {
  test('is a list marker, a box and what comes after it', () => {
    const task = taskAt('- [ ] buy milk')

    expect(task?.done).toBe(false)
    expect(task?.mark).toBe(' ')
    expect(task?.box).toBe(2)
    expect(words('- [ ] buy milk')).toBe('buy milk')
  })

  test('is done when the box holds anything but a space', () => {
    expect(taskAt('- [x] buy milk')?.done).toBe(true)
    expect(taskAt('- [X] buy milk')?.done).toBe(true)
    // What a theme gives a task of its own: cancelled, started, forwarded. All of
    // them are a task nobody is waiting on.
    expect(taskAt('- [-] buy milk')?.done).toBe(true)
    expect(taskAt('- [/] buy milk')?.done).toBe(true)
  })

  test('is written with any of the markers a list is', () => {
    for (const line of ['- [ ] a', '* [ ] a', '+ [ ] a', '1. [ ] a', '2) [ ] a']) {
      expect(taskAt(line), line).not.toBeNull()
    }
  })

  test('keeps its indentation, however deep', () => {
    const task = taskAt('    - [x] nested')

    expect(task?.indent).toBe(4)
    expect(task?.box).toBe(6)
    expect(words('    - [x] nested')).toBe('nested')
  })

  test('is a task with nothing written in it yet', () => {
    expect(taskAt('- [ ]')?.done).toBe(false)
    expect(words('- [ ]')).toBe('')
  })

  test('and is not a list, a link, or a box with nothing in it', () => {
    expect(taskAt('- buy milk')).toBeNull()
    expect(taskAt('a [x] in a sentence')).toBeNull()
    expect(taskAt('- [] buy milk')).toBeNull()
    expect(taskAt('- [xx] buy milk')).toBeNull()
    expect(taskAt('-[ ] buy milk')).toBeNull()
    expect(taskAt('')).toBeNull()
  })
})

describe('where a tick is written', () => {
  test('the box, so one character changes and the rest of the line does not', () => {
    // Every caller edits the file at an offset rather than rewriting the line:
    // the editor dispatches a one-character change and the app records one for
    // undo. So what this package answers with is where the box is.
    const task = taskAt('  * [x] buy milk')
    expect(task?.box).toBe(4)
    expect(task?.done).toBe(true)
    expect(taskAt('- buy milk')).toBeNull()
  })
})
