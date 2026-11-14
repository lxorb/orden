import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { root, watch } from './runes.svelte'

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
  },
}))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { viewport } = await import('../../src/lib/viewport.svelte')

const open = () => workspace.tabs.map((tab) => tab.shown)

beforeEach(() => {
  notes.clear()
  notes.set('/space/One.md', '# One')
  notes.set('/space/Two.md', '# Two')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  workspace.closed.stack = []
  workspace.panes.collapse()
  viewport.device = 'desktop'
})

afterEach(() => {
  workspace.tabs = []
  viewport.device = 'desktop'
})

test('a window that becomes a phone comes down to one document, and settles', async () => {
  await workspace.open('/space/One.md')
  await workspace.open('/space/Two.md')
  workspace.split('row')
  expect(workspace.panes.count).toBe(2)

  let runs = 0
  const stop = root(() => {
    watch(() => {
      runs++
      workspace.oneDocument()
    })
  })

  flushSync()
  expect(runs).toBe(1)
  expect(workspace.panes.count).toBe(2)

  const kept = workspace.active?.shown
  viewport.device = 'phone'
  flushSync()

  expect(workspace.panes.count).toBe(1)
  expect(open()).toEqual([kept])
  expect(runs).toBe(3)

  stop()
})
