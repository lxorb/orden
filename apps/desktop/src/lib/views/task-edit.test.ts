import { taskRowsOfText } from '@nib/bases/tasks'
import { describe, expect, test } from 'vitest'
import { changeOf, prefillFor } from './task-edit'

function task(line: string) {
  const found = taskRowsOfText('Notes', 'A.md', line)[0]?.task
  if (!found) throw new Error('no task')
  return found
}

describe('a task in quick add’s field and back', () => {
  test('the field holds what the task says', () => {
    const one = task('- [ ] Call [time:: 16:00] [deadline:: 2026-10-20] #admin ⏫ 📅 2026-10-13')
    expect(prefillFor(one, 'Their number.')).toEqual({
      text: 'Call',
      description: 'Their number.',
      fields: {
        due: '2026-10-13',
        time: '16:00',
        deadline: '2026-10-20',
        priority: 2,
        tags: ['admin'],
        remind: [],
      },
    })
  })

  test('saving changes the words and every field, and takes away what is gone', () => {
    const one = task('- [ ] Call [time:: 16:00] #admin ⏫ 📅 2026-10-13')
    const change = changeOf(one, {
      text: 'Call again',
      fields: { due: '2026-10-14', tags: ['admin', 'bank'], remind: [], priority: 1 },
    })
    expect(change).toEqual({
      text: 'Call again',
      due: '2026-10-14',
      time: null,
      recurrence: null,
      priority: 1,
      tags: ['admin', 'bank'],
      remind: [],
      duration: null,
      deadline: null,
    })
  })

  test('a task kept by its scheduled date stays kept by it, and a low priority stays low', () => {
    const one = task('- [ ] Plan 🔽 ⏳ 2026-10-13')
    const change = changeOf(one, {
      text: 'Plan',
      fields: { due: '2026-10-15', tags: [], remind: [] },
    })
    expect(change.scheduled).toBe('2026-10-15')
    expect(change.due).toBeUndefined()
    expect(change.priority).toBe(5)
    expect(change.text).toBeUndefined()
  })
})
