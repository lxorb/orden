import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { root, watch } from './runes.svelte'

/** One pane and one document, which is what a phone comes down to, driven the way
 *  App.svelte drives it: `$effect(() => workspace.oneDocument())`.
 *
 *  The method reads `viewport.touch` and what is open, and then closes tabs - so
 *  from inside an effect it writes state that same effect depends on, and the
 *  effect runs again. It settles because the second run finds one document already,
 *  and that is the whole of what is asserted here. src/lib/one-document.test.ts
 *  calls the same method by hand and cannot see any of it: in the node project a
 *  rune is compiled for the server, where `$state` is a plain field and there are
 *  no effects at all.
 *
 *  The mocks are src/lib/one-document.test.ts's, which is the point - a store test
 *  moved into this project keeps its setup and gains an effect. */

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
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

/** What is open, by the name each tab shows, in the order they stand in. */
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
  // Two notes side by side, which is a desktop and nothing a phone can hold.
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
  // A desktop keeps every pane and every tab it has: nothing was written, so
  // nothing woke the effect.
  expect(workspace.panes.count).toBe(2)

  const kept = workspace.active?.shown
  viewport.device = 'phone'
  flushSync()

  expect(workspace.panes.count).toBe(1)
  expect(open()).toEqual([kept])
  // Twice: the run the device woke, which closed the panes and the other tab, and
  // the one those writes woke, which found one document already.
  expect(runs).toBe(3)

  stop()
})
