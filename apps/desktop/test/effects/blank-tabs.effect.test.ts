import { beforeEach, expect, test, vi } from 'vitest'
import { idle } from './settle'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))
vi.mock('../../src/lib/windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/windows/src/api')>()),
  hearHere: () => Promise.resolve(() => undefined),
}))
const { workspace } = await import('../../src/lib/workspace/src/api')
const { tabOverview } = await import('../../src/lib/workspace/src/api')
await import('../../src/lib/workspace/src/blank-tabs.svelte')
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
  await idle(20)
  expect(open(blank.id)).toBe(true)
  tabOverview.open = false
  await vi.waitFor(() => expect(open(blank.id)).toBe(false))
})
