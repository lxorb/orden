import { providePort, type PortMap } from '@orden/contracts'
import { afterEach, describe, expect, test } from 'vitest'
import type { Todo } from '../../tasks-model/src/api'
import { Shown, shellWorld } from '../src/shown.svelte'

const todo = (id: string, space: string | null): Todo => ({
  id,
  title: id,
  description: '',
  labels: [],
  space,
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  order: 0,
  created: 0,
})
const undo: (() => void)[] = []
afterEach(() => {
  for (const one of undo.splice(0)) one()
})
function synced(remote: Record<string, string>) {
  const home = { id: 'local-home', name: 'Home', root: '/s/Home' }
  const work = { id: 'local-work', name: 'Work', root: '/s/Work' }
  undo.push(
    providePort('sync.workspace', {
      spaces: [home, work],
      activeSpace: home,
    } as unknown as PortMap['sync.workspace']),
    providePort('sync.store', {
      remoteIdFor: (root: string) => remote[root] ?? null,
    } as unknown as PortMap['sync.store']),
  )
}
describe('the space a todo is kept in', () => {
  test('is the account id of a synced space, the one every device and the server share', () => {
    synced({ '/s/Home': 'acct-home' })
    const shown = new Shown(shellWorld(() => []))
    expect(shown.space?.id).toBe('acct-home')
    expect(shown.spaces.map((one) => one.id)).toEqual(['acct-home', 'local-work'])
  })
  test('only this space shows todos written with the account id and the older local id', () => {
    synced({ '/s/Home': 'acct-home' })
    const list = [
      todo('from-claude', 'acct-home'),
      todo('from-before', 'local-home'),
      todo('elsewhere', 'acct-work'),
      todo('nowhere', null),
    ]
    const shown = new Shown(shellWorld(() => list))
    shown.setOnlySpace(true)
    expect(shown.todos.map((one) => one.id)).toEqual(['from-claude', 'from-before'])
    expect(shown.spaceName('local-home')).toBe('Home')
    expect(shown.spaceName('acct-home')).toBe('Home')
  })
})
