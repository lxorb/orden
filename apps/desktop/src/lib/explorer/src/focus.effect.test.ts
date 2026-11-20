import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Listing } from './commands'
import { settle } from '../../../../test/effects/settle'

const BOX = '/home/me/Box'
const disk: string[] = []
vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  FOUND: 'explorer://found',
  PROGRESS: 'explorer://progress',
  listFolder: (path: string): Promise<Listing> =>
    Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: (path === BOX ? disk : []).map((name) => ({
        name,
        kind: 'file' as const,
        folder: false,
        size: 1,
        modified: 0,
        created: 0,
        hidden: false,
      })),
    }),
  watchFolder: () => Promise.resolve(),
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () => Promise.resolve([{ kind: 'home', path: '/home/me', name: null }]),
  trashPaths: (paths: string[]) => {
    for (const path of paths) disk.splice(disk.indexOf(path.slice(BOX.length + 1)), 1)
    return Promise.resolve(paths.map((path) => ({ path, back: path, at: 1 })))
  },
  cancelJob: () => Promise.resolve(),
  peekAt: () => Promise.resolve({ bytes: new Uint8Array(), cut: false }),
  factsOf: () => Promise.reject(new Error('no facts here')),
  searchBelow: () => Promise.resolve({ found: 0, cut: false, cancelled: false }),
}))
const { workspace } = await import('../../workspace/src/api')
const ExplorerTab = (await import('./ExplorerTab.svelte')).default
const { viewOf } = await import('./view.svelte')
let target: HTMLElement
let close: (() => void) | undefined
beforeEach(() => {
  disk.splice(0, disk.length, 'alpha.txt', 'beta.txt', 'gamma.txt')
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})
async function explorer() {
  const tab = workspace.openUnsaved('explorer', JSON.stringify({ folder: BOX, back: [], ahead: [] }), 'Box')
  const made = mount(ExplorerTab, { target, props: { tab, focused: true } })
  close = () => void unmount(made)
  await settle()
  return viewOf(tab)
}
function key(key: string, more: KeyboardEventInit = {}) {
  ;(document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more }),
  )
  flushSync()
}
const focusedName = () =>
  document.activeElement?.closest('.rows')
    ? (document.activeElement.querySelector('.orden-row-label')?.textContent ?? '')
    : null
test('a row put in the trash leaves the keyboard on the next row, so Ctrl+Z right after undoes it', async () => {
  const undo = vi.spyOn(workspace, 'undoFileAction').mockResolvedValue(undefined)
  try {
    const view = await explorer()
    key('b')
    await settle()
    expect(focusedName()).toBe('beta.txt')
    key('Delete')
    await settle()
    expect(disk).toEqual(['alpha.txt', 'gamma.txt'])
    expect(focusedName()).toBe('gamma.txt')
    expect([...view.picked.names]).toEqual(['gamma.txt'])
    key('z', { ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
    key('ArrowUp')
    await settle()
    expect(focusedName()).toBe('alpha.txt')
  } finally {
    undo.mockRestore()
  }
})
test('the last row put in the trash leaves the keyboard on the row before, and the last of all on the list', async () => {
  await explorer()
  key('g')
  await settle()
  key('Delete')
  await settle()
  expect(focusedName()).toBe('beta.txt')
  key('a', { ctrlKey: true })
  key('Delete')
  await settle()
  expect(disk).toEqual([])
  expect(document.activeElement?.classList.contains('rows')).toBe(true)
})
