import { expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return [{ name: 's', path: '/s' }]
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
held.disk.folders.add('/s')
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { isDraft, isUnsaved } = await import('../../documents/src/api')
const { canWriteIn } = await import('../../sharing/src/api')
const { unsavedAmong } = await import('./closing-unsaved')
const TEXT = '# Licences\n\nThe words of the licences.\n'
test('a read-only text opens once, in reading view, with nothing to save, and is never kept for the next launch', async () => {
  workspace.spaces = [{ id: 'S', name: 's', root: '/s' }]
  workspace.activeSpaceId = 'S'
  const tab = workspace.openReadOnly('Open source licences', TEXT)
  expect(tab.reading).toBe(true)
  expect(tab.doc).toBe(TEXT)
  expect(isDraft(tab.note)).toBe(false)
  expect(isUnsaved(tab.note)).toBe(false)
  expect(canWriteIn(tab.note)).toBe(false)
  expect(unsavedAmong([tab], workspace.tabs)).toEqual([])
  expect(workspace.active?.id).toBe(tab.id)
  workspace.openUnsaved('note', 'other words')
  expect(workspace.openReadOnly('Open source licences', TEXT).id).toBe(tab.id)
  expect(workspace.tabs.filter((one) => one.name === 'Open source licences')).toHaveLength(1)
  expect(workspace.active?.id).toBe(tab.id)
  expect(workspace.persist()).toBe(true)
  expect(localStorage.getItem('orden:workspace')).not.toContain('Open source licences')
  workspace.close(tab.id)
  expect(JSON.stringify(workspace.closed.stack)).not.toContain('Open source licences')
})
