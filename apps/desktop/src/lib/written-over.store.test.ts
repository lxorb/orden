import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Nothing the app writes lands on a file somebody else's words are in.
 *
 *  Each describe here was a gesture that wrote a file without looking whether one
 *  was there, and replaced a note with no version kept of it - the one kind of
 *  loss nothing in the app can bring back.
 *
 *  The disk is a map; see test/disk.ts. */

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
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

/** The disk, which is there: it was made above. */
function files(): Map<string, string> {
  if (!disk.current) throw new Error('no disk')
  return disk.current.files
}

beforeEach(() => {
  disk.current?.reset()
  workspace.tabs = []
  workspace.panel = 'tree'
  workspace.undone.stack = []
})

describe('a draft saved into a space that is not on screen', () => {
  beforeEach(async () => {
    files().set('/home/Plan.md', '# Plan\nwords that were here first\n')
    files().set('/away/Other.md', '# Other\n')
    workspace.spaces = [
      { id: 'away', name: 'Away', root: '/away' },
      { id: 'home', name: 'Home', root: '/home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
  })

  test('steps past a note of the same name there rather than writing over it', async () => {
    // The draft keeps the space it was opened in, and its name comes from its
    // heading. Once another space is on screen the listing that names it is that
    // space's, which has no Plan.md in it - so the disk has to be asked.
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    tab.note.live.replace('# Plan\nthe draft\n', true)
    await workspace.selectSpace('away')

    const landed = await workspace.save(tab)
    await workspace.writesSettled()

    expect(landed).toBe('/home/Plan 2.md')
    expect(files().get('/home/Plan.md')).toBe('# Plan\nwords that were here first\n')
    expect(files().get('/home/Plan 2.md')).toBe('# Plan\nthe draft\n')
  })
})
