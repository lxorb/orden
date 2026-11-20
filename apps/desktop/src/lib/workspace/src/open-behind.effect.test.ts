import { flushSync } from 'svelte'
import { beforeEach, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return [{ name: 'Work', path: '/spaces/Work' }]
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
await import('../../workspace-ports')
const { serveWorkspace } = await import('./services')
const { arriving } = await import('../../accounts/src/api')
const ROOT = '/spaces/Work'
const at = (name: string) => `${ROOT}/${name}`
const scratched: string[] = []
const view = () => ({
  space: workspace.activeSpaceId,
  pane: workspace.panes.focusedId,
  shown: workspace.panes.all.map((one) => one.activeTabId),
  focus: document.activeElement,
})
beforeEach(async () => {
  const disk = held.disk!
  disk.reset()
  disk.folders.add(ROOT)
  for (const name of ['Here.md', 'Away.md', 'Scratch.md']) disk.files.set(at(name), `# ${name}\n`)
  disk.files.set(at('Board.canvas'), '{"nodes":[],"edges":[]}')
  scratched.length = 0
  serveWorkspace({
    scratchpad: {
      on: true,
      holds: (path) => path === at('Scratch.md'),
      open: () => {
        scratched.push('opened')
        return Promise.resolve()
      },
      show: () => undefined,
      hide: () => undefined,
    },
  })
  workspace.spaces = [{ id: 'work', name: 'Work', root: ROOT }]
  workspace.activeSpaceId = 'work'
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  await workspace.loadTree()
  await workspace.openEntry(at('Here.md'))
  workspace.openUnsaved('note', '', undefined, null, false)
  flushSync()
})
test('what an agent opens behind leaves the tab in front, the pane, the space and the keyboard where they were', async () => {
  const input = document.body.appendChild(document.createElement('input'))
  input.focus()
  const before = view()
  const count = workspace.tabs.length
  const opener = workspace.active?.id ?? null
  await workspace.openEntry(at('Away.md'), { activate: false, beside: true })
  await workspace.openEntry(at('Board.canvas'), { activate: false, beside: true })
  workspace.openPage('https://example.com/', 'behind')
  workspace.openUnsaved('note', 'words', undefined, opener, false)
  arriving.listing([at('Coming.md')])
  await workspace.openEntry(at('Coming.md'), { activate: false, beside: true })
  await workspace.openEntry(at('Scratch.md'), { activate: false, beside: true })
  flushSync()
  expect(view()).toEqual(before)
  expect(scratched).toEqual([])
  expect(workspace.tabs.length).toBe(count + 6)
  input.remove()
})
