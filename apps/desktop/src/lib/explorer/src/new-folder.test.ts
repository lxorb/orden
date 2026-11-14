import { expect, test, vi } from 'vitest'

const made = vi.hoisted(() => [] as string[])

vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: { path: string }) => {
    if (command === 'create_folder') made.push(args.path)
    return Promise.resolve()
  },
}))
vi.mock('./open', () => ({ inASpace: () => true }))
const { newFolder } = await import('./changes')
const { workspace } = await import('../../workspace.svelte')
vi.spyOn(workspace, 'loadTree').mockResolvedValue()

function filteredView() {
  const entries = ['New folder', 'apples', 'pears'].map((name) => ({ name }))
  const view = {
    listing: { path: '/space', own: false, spaces: true, entries },
    filter: 'app',
    search: null,
    get names() {
      return entries
        .map((one) => one.name)
        .filter((one) => !view.filter || one.includes(view.filter))
    },
    reload: () => {
      for (const path of made) entries.push({ name: path.slice('/space/'.length) })
      return Promise.resolve()
    },
    endSearch: vi.fn(),
    pick: vi.fn(),
    tell: vi.fn(),
    renaming: null as string | null,
  }
  return view
}

test('a new folder made while a filter hides a folder of the same name gets a free name of its own, and is shown to be named', async () => {
  const view = filteredView()
  await newFolder(view as never)
  expect(made).toHaveLength(1)
  const [path = ''] = made
  expect(path).toMatch(/^\/space\/New folder \d+$/)
  expect(view.filter).toBe('')
  expect(view.renaming).toBe(path.slice('/space/'.length))
})
