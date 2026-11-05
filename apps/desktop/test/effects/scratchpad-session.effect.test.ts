import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A session with the scratchpad open as a note, which its right side icon's double
 *  press opens (#1110): the tab comes back like any note's, words not yet written and
 *  all, and while it is open the scratchpad is that tab - its card's key brings the tab
 *  forward, a link to it lands there, and what is put on its end goes into the tab's
 *  document as well as the file, so the tab never writes the words before it back. See
 *  is.svelte.ts and pad.ts. */

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve([{ name: 'Work', path: '/spaces/Work' }])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PLAN = '/spaces/Work/Plan.md'
const PAD = '/app/Scratchpad.md'

const draft = (path: string, doc: string, dirty: boolean) => ({
  kind: 'note',
  path,
  name: path.split('/').pop(),
  doc,
  dirty,
  cursor: 0,
  scroll: 0,
})

test('a session’s scratchpad tab comes back, and is the scratchpad while it is open', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(PLAN, '# Plan\n')
  disk.current.files.set(PAD, 'Old words\n')
  localStorage.clear()
  localStorage.setItem(
    'nib:workspace',
    JSON.stringify({
      version: 2,
      spaces: [{ id: 'work', name: 'Work', root: '/spaces/Work' }],
      activeSpace: 'work',
      panel: null,
      layout: {
        frame: {
          kind: 'pane',
          pane: {
            id: 'p1',
            tabs: [
              draft(PLAN, '# Plan\n', false),
              draft(PAD, 'Old words\nNot yet written\n', true),
            ],
            active: 1,
            linked: false,
          },
        },
        focused: 'p1',
        panel: null,
      },
      closed: [{ draft: draft(PAD, 'Old words\n', false), paneId: 'p1', at: 1 }],
    }),
  )

  const { workspace } = await import('../../src/lib/workspace.svelte')
  await workspace.restore()
  flushSync()

  expect(workspace.tabs.map((one) => one.path)).toEqual([PLAN, PAD])
  expect(workspace.active?.path).toBe(PAD)
  expect(workspace.documentAt(PAD)?.text).toBe('Old words\nNot yet written\n')

  const { shown } = await import('../../src/lib/scratchpad/is.svelte')
  const { scratchpad } = await import('../../src/lib/scratchpad/pad')
  vi.spyOn(scratchpad, 'where').mockResolvedValue(PAD)

  // The card's key, and a link to it, bring the tab forward rather than the card up.
  workspace.activate(workspace.tabs[0]?.id ?? '')
  shown.show()
  expect(shown.on).toBe(false)
  expect(workspace.active?.path).toBe(PAD)
  workspace.activate(workspace.tabs[0]?.id ?? '')
  await workspace.open(PAD)
  expect(shown.on).toBe(false)
  expect(workspace.active?.path).toBe(PAD)

  // Words put on its end are in the tab and in the file, the tab's own unwritten ones too.
  await scratchpad.append('Added')
  expect(workspace.documentAt(PAD)?.text).toBe('Old words\nNot yet written\n\nAdded\n')
  expect(disk.current.files.get(PAD)).toBe('Old words\nNot yet written\n\nAdded\n')
  expect(workspace.documentAt(PAD)?.dirty).toBe(false)
})
