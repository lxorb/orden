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
const added: unknown[] = []
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
      add: async (fields: Record<string, unknown>) => {
        added.push(fields)
        return { ok: true, value: { ...todo('t3', null, String(fields.title)), ...fields } }
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch })
        const was = held.find((one) => one.id === id)
        return { ok: true, value: { ...was, ...patch } }
      },
    },
  }
})
const { addTask, listTasks, updateTask } = await import('./tasks')
const caller = (spaces: string[] | 'all') =>
  callerOf({
    id: 'claude',
    name: 'Claude',
    scopes: ['notes.read', 'notes.write'],
    spaces,
    mode: 'unsupervised',
  })
const result = (answer: unknown) => (answer as { result: Record<string, unknown> }).result
beforeEach(() => {
  updates.length = 0
  added.length = 0
})
describe('an agent given space A only', () => {
  test('reaches no todo at all', async () => {
    const narrow = caller(['A'])
    await expect(listTasks({ verb: 'list_tasks', caller: narrow, args: {} })).rejects.toMatchObject({
      code: 'not_granted',
    })
    await expect(addTask({ verb: 'add_task', caller: narrow, args: { title: 'Sneaky' } })).rejects.toMatchObject({
      code: 'not_granted',
    })
    await expect(
      updateTask({ verb: 'update_task', caller: narrow, args: { id: 't1', done: true } }),
    ).rejects.toMatchObject({ code: 'not_granted' })
    expect(added).toEqual([])
    expect(updates).toEqual([])
  })
})
describe('an agent given every space', () => {
  test('lists every todo, none with a space', async () => {
    const todos = result(await listTasks({ verb: 'list_tasks', caller: caller('all'), args: {} })).todos as Record<
      string,
      unknown
    >[]
    expect(todos.map((one) => one.title)).toEqual(['Work item', 'Divorce lawyer'])
    expect(todos.every((one) => !('space' in one))).toBe(true)
  })
  test('ignores a space it is given on a list', async () => {
    const todos = result(await listTasks({ verb: 'list_tasks', caller: caller('all'), args: { space: 'A' } }))
      .todos as unknown[]
    expect(todos).toHaveLength(2)
  })
  test('adds a todo without a space', async () => {
    const made = result(
      await addTask({ verb: 'add_task', caller: caller('all'), args: { title: 'Call mum', space: 'B' } }),
    )
    expect(added).toEqual([{ title: 'Call mum', done: false }])
    expect('space' in made).toBe(false)
  })
  test('changes a todo and drops a space it is given', async () => {
    await updateTask({ verb: 'update_task', caller: caller('all'), args: { id: 't2', done: true, space: 'A' } })
    expect(updates).toEqual([{ id: 't2', patch: { done: true } }])
  })
})
