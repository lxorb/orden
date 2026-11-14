import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

type Heard = (event: { payload: { folders: string[] } }) => void

const ears = vi.hoisted(() => ({
  heard: null as Heard | null,
  open: null as (() => void) | null,
  calls: [] as string[],
  disk: new Map<string, string[]>(),
}))

vi.mock('../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../platform/src/tauri')>()),
  isDesktop: true,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, heard: Heard) => {
    await new Promise<void>((resolve) => (ears.open = resolve))
    ears.heard = heard
    return () => undefined
  },
}))

vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  listFolder: (path: string): Promise<Listing> => {
    ears.calls.push(`list ${path}`)
    const names = ears.disk.get(path) ?? []
    return Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: names.map((name) => ({
        name,
        kind: 'file',
        folder: false,
        size: 1,
        modified: 0,
        created: 0,
        hidden: false,
      })),
    })
  },
  watchFolder: (folder: string) => {
    ears.calls.push(`watch ${folder}`)
    return Promise.resolve()
  },
  unwatchFolder: (folder: string) => {
    ears.calls.push(`unwatch ${folder}`)
    return Promise.resolve()
  },
}))

const { workspace } = await import('../workspace.svelte')
const ExplorerColumn = (await import('./ExplorerColumn.svelte')).default
const { viewOf } = await import('./view.svelte')

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})

test('a folder is watched only once its changes can be heard, and the column beside the list follows its own folder', async () => {
  ears.disk.set('/home/me/letters', ['a.txt'])
  const tab = workspace.openUnsaved('explorer', '', 'me')
  const view = viewOf(tab)
  view.spec = { folder: '/home/me', back: [], ahead: [] }
  await view.appear()
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(ExplorerColumn, { target, props: { view, folder: '/home/me/letters' } })
  close = () => void unmount(made)
  await wait(250)
  expect(ears.calls).toEqual(['list /home/me', 'list /home/me/letters'])

  ears.open?.()
  await wait(10)
  expect([...ears.calls].sort()).toEqual([
    'list /home/me',
    'list /home/me/letters',
    'watch /home/me',
    'watch /home/me/letters',
  ])

  ears.disk.set('/home/me/letters', ['a.txt', 'b.txt'])
  ears.heard?.({ payload: { folders: ['/home/me/letters'] } })
  await wait(250)
  flushSync()
  const names = [...target.querySelectorAll('.orden-row-label')].map((one) => one.textContent)
  expect(names).toEqual(['a.txt', 'b.txt'])

  close()
  close = undefined
  view.stop()
  expect(ears.calls.slice(-2)).toEqual(['unwatch /home/me/letters', 'unwatch /home/me'])
})
