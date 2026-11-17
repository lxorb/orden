import { expect, test, vi } from 'vitest'

const added = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('../../tasks-model/src/api', async (original) => ({
  ...(await original<typeof import('../../tasks-model/src/api')>()),
  priorityOf: () => 0,
  todos: {
    add: (patch: Record<string, unknown>) => {
      added.push(patch)
      return Promise.resolve({ ok: true, value: { id: 't1', ...patch } })
    },
  },
}))

const { addTask } = await import('./write')

test('the start date picked in quick add is the todo’s start, and its deadline stays its own', async () => {
  added.length = 0
  await addTask({ text: 'Pay rent', fields: { tags: [], due: '2026-11-20' } } as never)
  await addTask({
    text: 'File taxes',
    fields: { tags: [], due: '2026-11-20', deadline: '2026-11-30' },
  } as never)
  expect(added.map((one) => [one.title, one.start, one.deadline])).toEqual([
    ['Pay rent', '2026-11-20', null],
    ['File taxes', '2026-11-20', '2026-11-30'],
  ])
})
