import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A page note's paper is `<name>.pages.pdf` beside it, and a PDF of that name already
 *  there is somebody's own - macOS Pages names every PDF it saves that way (#538). So a
 *  name for a page note is taken where its paper's would be. */

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
disk.current = new Disk(true)
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

const ROOT = '/space'

describe('a page note’s name', () => {
  beforeEach(async () => {
    const one = disk.current
    if (!one) throw new Error('no disk')
    one.reset()
    one.files.set(`${ROOT}/Report.pages.pdf`, '%PDF-1.7\n')
    workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
    workspace.activeSpaceId = 's'
    workspace.tabs = []
    await workspace.loadTree()
  })

  test('is taken where its paper would land on a PDF already there', () => {
    expect(workspace.freeName(ROOT, 'Report.pages')).toBe('Report 2.pages')
  })

  test('and only a page note’s is', () => {
    expect(workspace.freeName(ROOT, 'Report.md')).toBe('Report.md')
  })
})
