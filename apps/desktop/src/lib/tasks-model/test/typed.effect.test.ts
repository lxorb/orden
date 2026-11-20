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
test('a todo added by text that says how it repeats keeps that rule and leaves it out of its title', async () => {
  const added = await addTask('Pay rent every month on the 1st')
  const made = todos.todos.find((one) => one.id === added?.id)
  expect(made).toMatchObject({ title: 'Pay rent', repeat: 'every month on the 1st' })
})
