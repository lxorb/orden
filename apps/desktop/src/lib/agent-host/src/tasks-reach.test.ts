import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const spaceA = { id: 'a', root: '/s/A', name: 'A' }
const spaceB = { id: 'b', root: '/s/B', name: 'B' }

const todo = (id: string, space: string | null, title: string) => ({
  id,
  title,
  description: `secret of ${title}`,
  done: false,
  doneAt: null,
  labels: [],
  space,
  start: null,
  deadline: null,
  priority: 0,
  subtasks: [],
  order: 0,
})

const held = [todo('t1', 'a', 'Work item'), todo('t2', 'b', 'Divorce lawyer')]
const updates: { id: string; patch: unknown }[] = []

vi.mock('../../workspace/src/api', () => ({
  workspace: { spaces: [spaceA, spaceB], activeSpace: spaceA, tabs: [] },
}))

vi.mock('./notes', () => ({ at: vi.fn(), made: vi.fn(), noteOf: vi.fn() }))
vi.mock('./docs', () => ({ notes: {} }))

vi.mock('../../tasks-model/src/api', async (original) => {
  const real = await original<typeof import('../../tasks-model/src/api')>()
  return {
    ...real,
    todos: {
      todos: held,
      todo: (id: string) => held.find((one) => one.id === id),
      update: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch })
        const was = held.find((one) => one.id === id)
        return { ok: true, value: { ...was, ...patch } }
      },
    },
  }
})

const { listTasks, updateTask } = await import('./tasks')

const caller = () =>
  callerOf({
    id: 'claude',
    name: 'Claude',
    scopes: ['notes.read', 'notes.write'],
    spaces: ['A'],
    mode: 'unsupervised',
  })

beforeEach(() => {
  updates.length = 0
})

describe('an agent given space A only', () => {
  test('lists only the todos of space A', async () => {
    const answer = await listTasks({ verb: 'list_tasks', caller: caller(), args: {} })
    const todos = (answer as { result: { todos: { title: string }[] } }).result.todos
    expect(todos.map((one) => one.title)).toEqual(['Work item'])
  })

  test('cannot change a todo of space B, nor learn it is there', async () => {
    await expect(
      updateTask({ verb: 'update_task', caller: caller(), args: { id: 't2', done: true } }),
    ).rejects.toMatchObject({ code: 'no_such_file' })
    expect(updates).toEqual([])
  })

  test('changes a todo of space A', async () => {
    await updateTask({ verb: 'update_task', caller: caller(), args: { id: 't1', done: true } })
    expect(updates).toEqual([{ id: 't1', patch: { done: true } }])
  })
})
