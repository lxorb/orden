import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { expect, test } from 'vitest'
import { addTask, dayAfter, dayOf, todos } from '../src/api'

providePort('sync.account', {
  token: null,
  user: null,
  spaces: [],
  signedIn: false,
  loadSpaces: async () => undefined,
  recheck: async () => undefined,
  signedOutBy: () => false,
  forgetWithSession: () => undefined,
  askBeforeLeaving: () => undefined,
})
test('a todo added by text keeps the words it does not read, like a time, in its title', async () => {
  const added = await addTask('call at 4pm tomorrow')
  const made = todos.todos.find((one) => one.id === added?.id)
  expect(made?.title).toContain('at 4pm')
  expect(made?.start).toBe(dayAfter(dayOf(), 1))
})
