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
const { links } = await import('./link-index.svelte')
const { pages } = await import('./web-tab/pages.svelte')
const { sync } = await import('./sync.svelte')

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

  test('steps past a PDF there that a page note of its name would take for its paper', async () => {
    // A page note holds `<name>.pdf` beside it as its paper, so landing beside the
    // person's own `Report.pages.pdf` hid that PDF in the note and trashed it with it.
    files().set('/home/Report.pages.pdf', '%PDF-1.7\n')
    workspace.openBlank()
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    await workspace.selectSpace('away')

    const landed = await workspace.save(tab, '/home', 'Report.pages')
    await workspace.writesSettled()

    expect(landed).toBe('/home/Report 2.pages')
    expect(files().has('/home/Report.pages')).toBe(false)
  })
})

describe('a website kept into a space that is not on screen', () => {
  beforeEach(async () => {
    files().set('/home/Example.url', '[InternetShortcut]\r\nURL=https://other.org/mine\r\n')
    files().set('/away/Other.md', '# Other\n')
    workspace.spaces = [
      { id: 'away', name: 'Away', root: '/away' },
      { id: 'home', name: 'Home', root: '/home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
  })

  test('steps past a web note of the same name on another site there', async () => {
    // The tab keeps the space it was opened in, so Save keeps it there; the listing
    // that names it is the other space's, which has no Example.url in it.
    workspace.openWebsite()
    const tab = workspace.active
    if (!tab) throw new Error('no tab')
    tab.address = 'https://example.com/a'
    pages.of(tab.id).title = 'Example'
    await workspace.selectSpace('away')

    const landed = await workspace.save(tab)
    await workspace.writesSettled()

    expect(landed).toBe('/home/Example 2.url')
    expect(files().get('/home/Example.url')).toBe(
      '[InternetShortcut]\r\nURL=https://other.org/mine\r\n',
    )
  })
})

describe('a note made beside a tab from a space that is not on screen', () => {
  beforeEach(async () => {
    files().set('/home/Ideas.md', 'my ideas\n')
    files().set('/home/Plan.md', '# Plan\n')
    files().set('/away/Other.md', '# Other\n')
    workspace.spaces = [
      { id: 'away', name: 'Away', root: '/away' },
      { id: 'home', name: 'Home', root: '/home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    await workspace.open('/home/Plan.md')
    // Tabs are kept across spaces, so Plan.md stays in front while the listing is
    // the other space's, which has no Ideas.md in it.
    await workspace.selectSpace('away')
  })

  test('extracted, steps past a note of the same name there', async () => {
    const tab = workspace.active
    if (tab?.path !== '/home/Plan.md') throw new Error('Plan.md is not in front')
    const text = '# Plan\n\n# Ideas\n\nnew\n'
    tab.note.replace(text, false)
    await workspace.extractSelection(text.indexOf('# Ideas'), text.length)

    expect(files().get('/home/Ideas.md')).toBe('my ideas\n')
    expect(files().get('/home/Ideas 2.md')).toContain('new')
  })

  test('out of a canvas card, steps past a note of the same name there', async () => {
    const landed = await workspace.noteFrom('# Ideas\ncard\n', '/home')

    expect(landed).toBe('/home/Ideas 2.md')
    expect(files().get('/home/Ideas.md')).toBe('my ideas\n')
  })
})

describe('a file made beside one the list does not show', () => {
  // The list leaves out what is named with a dot unless hidden files are shown, so
  // a name it calls free can be a file that is there.
  beforeEach(() => {
    workspace.spaces = [{ id: 'home', name: 'Home', root: '/home' }]
    workspace.activeSpaceId = 'home'
  })

  test('a note made in a dot folder steps past the hidden note there', async () => {
    files().set('/home/.notes/Plan.md', 'precious\n')
    await workspace.loadTree()

    // What the palette makes for `.notes/Plan`.
    await workspace.createNote('/home/.notes', 'Plan.md')
    await workspace.writesSettled()

    expect(files().get('/home/.notes/Plan.md')).toBe('precious\n')
    expect(files().has('/home/.notes/Plan 2.md')).toBe(true)
  })

  test('a dotfile dropped from outside steps past the hidden one there', async () => {
    files().set('/home/.gitignore', 'secrets/\n')
    await workspace.loadTree()

    const words = new TextEncoder().encode('node_modules/\n')
    const picked = {
      name: '.gitignore',
      webkitRelativePath: '',
      arrayBuffer: async () => words.buffer,
    }
    await workspace.bringIn([picked], '/home')

    expect(files().get('/home/.gitignore')).toBe('secrets/\n')
    expect(files().get('/home/.gitignore 2')).toBe('node_modules/\n')
  })
})

describe('a delete undone after a note took its name', () => {
  beforeEach(async () => {
    files().set('/space/Plan.md', '# Plan\nthe old words\n')
    workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
    workspace.activeSpaceId = 's'
    await workspace.loadTree()

    // Signed in, with the note on the account, a delete is not this device's to keep:
    // the note goes outright and the undo writes back the words read on the way out.
    Object.defineProperty(account, 'signedIn', { get: () => true, configurable: true })
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    vi.spyOn(sync, 'tracked').mockReturnValue({ id: 'n', version: 1, hash: 'h' })
  })

  afterEach(() => {
    Reflect.deleteProperty(account, 'signedIn')
    vi.restoreAllMocks()
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
    vi.spyOn(sync, 'remoteIdFor').mockReturnValue('remote')
    vi.spyOn(sync, 'tracked').mockReturnValue({ id: 'n', version: 1, hash: 'h' })
  })

  afterEach(() => {
    Reflect.deleteProperty(account, 'signedIn')
    vi.restoreAllMocks()
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

describe('a block of a note open in another tab, named from a link', () => {
  beforeEach(async () => {
    files().set('/home/A.md', '# A\n')
    files().set('/home/B.md', '# B\n\nfirst para\n\nsecond\n')
    workspace.spaces = [{ id: 'home', name: 'Home', root: '/home' }]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
  })

  test('keeps its name through the next save of that tab', async () => {
    await workspace.open('/home/B.md')
    const b = workspace.active
    if (!b) throw new Error('no tab')
    await workspace.open('/home/A.md')

    // `[[B#^` typed in A, and the first paragraph of B picked.
    const id = await links.nameBlock('B.md', 2, '/home')
    expect(files().get('/home/B.md')).toContain(`first para ^${id ?? ''}`)

    // Back in B, the reader types on.
    workspace.activate(b.id)
    b.note.live.replace(`${b.note.text}\nmore\n`, true)
    await workspace.save(b)
    await workspace.writesSettled()

    expect(files().get('/home/B.md')).toContain(`first para ^${id ?? ''}`)
    expect(files().get('/home/B.md')).toContain('more')
  })
})
