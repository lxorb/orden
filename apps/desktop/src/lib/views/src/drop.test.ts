import type { Row } from '@orden/bases'
import { describe, expect, test } from 'vitest'
import { dropInto } from './drop'

const task = (fields: Record<string, unknown>) =>
  ({
    kind: 'task',
    note: {},
    task: { text: 'Pay rent', status: ' ', done: false, tags: [], priority: 4, ...fields },
  }) as unknown as Row

describe('a task card dropped on a board grouped by one of its fields', () => {
  test('takes the column it lands in', () => {
    expect(dropInto('task.status', 'x', task({}))).toEqual({ change: { task: { done: true } } })
    expect(dropInto('task.status', '/', task({}))).toEqual({
      change: { task: { status: '/', completed: null, cancelledOn: null } },
    })
    expect(dropInto('task.priority', 1, task({}))).toEqual({ change: { task: { priority: 1 } } })
    expect(dropInto('task.due', '2026-11-20', task({}))).toEqual({
      change: { task: { due: '2026-11-20' } },
    })
    expect(dropInto('task.tags', 'home', task({ tags: ['work'] }), 'work')).toEqual({
      change: { task: { tags: ['home'] } },
    })
    expect(dropInto('task.assignee', 'Ana', task({}))).toEqual({
      change: { task: { assignee: 'Ana' } },
    })
  })

  test('changes nothing when it lands in its own column', () => {
    expect(dropInto('task.status', ' ', task({}))).toBeNull()
    expect(dropInto('task.priority', 4, task({}))).toBeNull()
  })

  test('moves a task due today onto the day it is dropped on', () => {
    const today = task({ due: '2026-11-15' })
    expect(dropInto('formula.day', '2026-11-21', today, undefined, '2026-11-15')).toEqual({
      change: { task: { due: '2026-11-21' } },
    })
    expect(dropInto('formula.day', '2026-11-21', task({}), undefined, '2026-11-15')).toEqual({
      change: { task: { start: '2026-11-21' } },
    })
  })
})
