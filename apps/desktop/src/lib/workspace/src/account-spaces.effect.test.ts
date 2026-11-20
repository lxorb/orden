import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { leaveSpaces } from '../../left-spaces/src/api'
import { workspace } from './api'

const NOTES = { name: 'Notes', path: '/w/Notes' }
const ALICE = { name: 'Alice private', path: '/w/Alice' }
type Who = NonNullable<typeof account.user>
const as = (id: string) => ({ id, email: `${id}@example.com` }) as unknown as Who
test('the spaces follow the account that signs in, in place, without a reload', async () => {
  providePort('backend.web', {
    invoke: <T>(command: string) =>
      command === 'list_spaces' ? Promise.resolve([NOTES, ALICE] as T) : Promise.reject(new Error(command)),
  })
  account.user = as('alice')
  workspace.restored = true
  flushSync()
  await workspace.loadSpaces()
  expect(workspace.spaces.map((one) => one.root)).toEqual([NOTES.path, ALICE.path])
  leaveSpaces('alice', [ALICE.path])
  account.user = as('bob')
  flushSync()
  await vi.waitFor(() => expect(workspace.spaces.map((one) => one.root)).toEqual([NOTES.path]))
  account.user = as('alice')
  flushSync()
  await vi.waitFor(() => expect(workspace.spaces.map((one) => one.root)).toEqual([NOTES.path, ALICE.path]))
})
