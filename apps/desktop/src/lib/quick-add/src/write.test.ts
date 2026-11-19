import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'

const { todos } = await import('../../tasks-model/src/api')
await todos.opened({ owner: null, server: null, device: 'test' })
const { addTask } = await import('./write')
test('the start date picked in quick add is the todo’s start, and its deadline stays its own', async () => {
  const rent = await addTask({ text: 'Pay rent', fields: { tags: [], due: '2026-11-20' } } as never)
  const taxes = await addTask({
    text: 'File taxes',
    fields: { tags: [], due: '2026-11-20', deadline: '2026-11-30' },
  } as never)
  expect([rent, taxes].map((one) => [one?.title, one?.start, one?.deadline])).toEqual([
    ['Pay rent', '2026-11-20', null],
    ['File taxes', '2026-11-20', '2026-11-30'],
  ])
})
