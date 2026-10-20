import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
const { account } = await import('./account.svelte')

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

describe('a delete undone after a note took its name', () => {
  beforeEach(async () => {
    files().set('/space/Plan.md', '# Plan\nthe old words\n')
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    await workspace.loadTree()

    // Signed in, a delete is not this device's to keep: the note goes outright and
    // the undo writes back the words read on the way out.
    Object.defineProperty(account, 'signedIn', { get: () => true, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(account, 'signedIn')
  })

  test('puts the old note back beside the new one, which keeps its words', async () => {
    await workspace.remove('/space/Plan.md', false)
    files().set('/space/Plan.md', '# Plan\nwritten today\n')

    await workspace.undoFileAction()

    expect(files().get('/space/Plan.md')).toBe('# Plan\nwritten today\n')
    expect(files().get('/space/Plan 2.md')).toBe('# Plan\nthe old words\n')
    expect(workspace.undone.stack).toEqual([])
  })
})

describe('a folder deleted signed in, undone after a note took a name in it', () => {
  beforeEach(async () => {
    files().set('/space/Journal/2026-10-19.md', '# Today\nthe old words\n')
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    await workspace.loadTree()
    Object.defineProperty(account, 'signedIn', { get: () => true, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(account, 'signedIn')
  })

  test('with nothing made since, puts its notes back where they were', async () => {
    await workspace.remove('/space/Journal', true)
    expect(files().has('/space/Journal/2026-10-19.md')).toBe(false)

    // The row was out of the tree before what it held was read, so the undo had
    // nothing to write and gave back an empty folder.
    await workspace.undoFileAction()

    expect(files().get('/space/Journal/2026-10-19.md')).toBe('# Today\nthe old words\n')
  })

  test('holding a picture, is left to Recently deleted rather than put back without it', async () => {
    files().set('/space/Journal/shot.png', 'not words')
    disk.current?.unreadable.add('/space/Journal/shot.png')
    await workspace.loadTree()

    await workspace.remove('/space/Journal', true)

    // The file list leaves the picture out, and an undo read from it put the note
    // back and said nothing of the picture.
    expect(workspace.undone.stack).toEqual([])
  })

  test("holding a Finder's .DS_Store and a desktop.ini, is still put back", async () => {
    files().set('/space/Journal/.DS_Store', 'not words')
    disk.current?.unreadable.add('/space/Journal/.DS_Store')
    files().set('/space/Journal/desktop.ini', 'not words')
    disk.current?.unreadable.add('/space/Journal/desktop.ini')
    await workspace.loadTree()

    await workspace.remove('/space/Journal', true)
    await workspace.undoFileAction()

    // Neither is words, nor kept by sync; each stopped the undo being recorded.
    expect(files().get('/space/Journal/2026-10-19.md')).toBe('# Today\nthe old words\n')
  })

  test('puts the old note back beside the new one, which keeps its words', async () => {
    await workspace.remove('/space/Journal', true)
    // Today's note made again in the folder made again, and typed into.
    files().set('/space/Journal/2026-10-19.md', '# Today\nwritten since\n')

    await workspace.undoFileAction()

    expect(files().get('/space/Journal/2026-10-19.md')).toBe('# Today\nwritten since\n')
    expect(files().get('/space/Journal/2026-10-19 2.md')).toBe('# Today\nthe old words\n')
  })
})
