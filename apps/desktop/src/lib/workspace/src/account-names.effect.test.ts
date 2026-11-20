import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { keepHomes, leaveSpaces } from '../../left-spaces/src/api'
import { workspace } from './api'

type Who = NonNullable<typeof account.user>
type Remote = (typeof account.spaces)[number]
const as = (id: string) => ({ id, email: `${id}@example.com` }) as unknown as Who
const remote = (id: string, name: string) =>
  ({ id, name, position: 0, icon: null, role: 'owner', shared: false }) as Remote
const shown = () => workspace.spaces.map((one) => `${one.name}@${one.root}`)
test("a space shows its account's name when another account's folder holds that name, and catches up when the account's spaces arrive", async () => {
  let listed = [
    { name: 'Journal', path: '/n/Journal' },
    { name: 'Journal 2', path: '/n/Journal 2' },
  ]
  providePort('backend.web', {
    invoke: <T>(command: string) =>
      command === 'list_spaces' ? Promise.resolve(listed as T) : Promise.reject(new Error(command)),
  })
  workspace.restored = true
  account.user = as('alice')
  flushSync()
  leaveSpaces('alice', ['/n/Journal'])
  keepHomes('bob', [{ root: '/n/Journal 2', spaceId: 'r1' }])
  account.user = as('bob')
  flushSync()
  await vi.waitFor(() => expect(shown()).toEqual(['Journal 2@/n/Journal 2']))
  account.spaces = [remote('r1', 'Journal')]
  flushSync()
  await vi.waitFor(() => expect(shown()).toEqual(['Journal@/n/Journal 2']))
  listed = [{ name: 'Journal 2', path: '/n/Journal 2' }]
  await workspace.loadSpaces()
  expect(shown()).toEqual(['Journal 2@/n/Journal 2'])
})
