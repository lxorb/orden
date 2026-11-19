import 'fake-indexeddb/auto'
import { providePort } from '@orden/contracts'
import { expect, test } from 'vitest'
import { addTask, listed, tickTask } from '../src/api'

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
test('a task added before anything opened the todos still lands, and can be listed and ticked', async () => {
  const made = await addTask('Water the plants', { typed: false })
  expect(made).not.toBeNull()
  if (!made) return
  expect((await listed()).tasks.map((one) => one.text)).toEqual(['Water the plants'])
  expect(await tickTask(made.id, true)).toBe(true)
  expect((await listed()).tasks).toEqual([])
})
