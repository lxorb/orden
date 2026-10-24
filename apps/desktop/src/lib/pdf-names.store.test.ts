import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A page note's paper is `<name>.pages.pdf` beside it, so a PDF of that name put
 *  beside a page note `<name>.pages` is taken for its paper: hidden from the list, drawn
 *  over, and deleted with the note. macOS Pages names every PDF it saves that way, so a
 *  name for a PDF is taken where the page note it would belong to is there. */

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

describe('a PDF’s name', () => {
  beforeEach(async () => {
    const one = disk.current
    if (!one) throw new Error('no disk')
    one.reset()
    one.files.set(`${ROOT}/Report.pages`, '{}')
    workspace.spaces = [{ id: 's', name: 'Notes', root: ROOT }]
    workspace.activeSpaceId = 's'
    workspace.tabs = []
    await workspace.loadTree()
  })

  test('is taken where a page note would take the PDF for its paper', () => {
    expect(workspace.freeName(ROOT, 'Report.pages.pdf')).toBe('Report.pages 2.pdf')
  })

  test('and only where that note is', () => {
    expect(workspace.freeName(ROOT, 'Lecture.pages.pdf')).toBe('Lecture.pages.pdf')
  })
})
