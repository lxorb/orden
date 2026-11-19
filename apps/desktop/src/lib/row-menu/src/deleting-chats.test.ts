import { beforeEach, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const asked = vi.hoisted(() => ({ paths: [] as string[][], answer: false }))
providePort('chats', {
  list: () => Promise.resolve([]),
  chatAt: () => Promise.resolve(null),
  part: () => Promise.resolve(null),
  offer: () => Promise.resolve(),
  openLink: () => Promise.resolve(),
  mayDelete: (paths) => {
    asked.paths.push([...paths])
    return Promise.resolve(asked.answer)
  },
})
const { removeAsking } = await import('./row-menu')
const { workspace } = await import('../../workspace/src/api')
type Entry = import('../../workspace/src/api').Entry
const entry = (path: string, children?: Entry[]): Entry => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: children !== undefined,
  modified: 0,
  created: 0,
  children: children ?? [],
})
beforeEach(() => {
  asked.paths = []
  asked.answer = false
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
  workspace.tree = entry('/s', [
    entry('/s/Trip', [entry('/s/Trip/Plans.chat'), entry('/s/Trip/Notes.md')]),
    entry('/s/loose.md'),
  ])
})
test('deleting a folder asks about the chats inside it, and Cancel keeps the folder', async () => {
  const removing = vi.spyOn(workspace, 'removeMany').mockResolvedValue(undefined)
  await removeAsking(['/s/Trip'])
  expect(asked.paths).toEqual([['/s/Trip/Plans.chat']])
  expect(removing).not.toHaveBeenCalled()
  removing.mockRestore()
})
test('a delete with no chat in it asks nothing', async () => {
  const removing = vi.spyOn(workspace, 'removeMany').mockResolvedValue(undefined)
  await removeAsking(['/s/loose.md'])
  expect(asked.paths).toEqual([])
  expect(removing).toHaveBeenCalledOnce()
  removing.mockRestore()
})
