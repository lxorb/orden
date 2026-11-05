/** A new tab nothing was done with goes a turn after it is left, and not while the tab
 *  overview is up (#1040). Which tab goes is workspace.test.ts; this is when. See
 *  workspace/blank-tabs.svelte.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))
vi.mock('../../src/lib/own-window', () => ({ hearHere: () => Promise.resolve(() => undefined) }))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
await import('../../src/lib/workspace/blank-tabs.svelte')

const open = (id: string) => workspace.tabs.some((one) => one.id === id)

function leftForAnother() {
  workspace.newTab()
  const blank = workspace.active
  if (!blank) throw new Error('no new tab')
  workspace.openUnsaved('note', 'words')
  return blank
}

beforeEach(() => {
  tabOverview.open = false
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

test('goes a turn after another tab is brought in front, and not in the same turn', async () => {
  const blank = leftForAnother()
  expect(open(blank.id)).toBe(true)
  await vi.waitFor(() => expect(open(blank.id)).toBe(false))
})

test('stays while the tab overview is up, and goes as it is put away', async () => {
  tabOverview.open = true
  const blank = leftForAnother()
  await new Promise((done) => setTimeout(done, 20))
  expect(open(blank.id)).toBe(true)

  tabOverview.open = false
  await vi.waitFor(() => expect(open(blank.id)).toBe(false))
})
