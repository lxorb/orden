import { afterEach, describe, expect, test, vi } from 'vitest'

/** The palette's rows that make a file, in a space shared to be read.
 *
 *  Each of them writes a new file into the space in front, and a space shared with
 *  this account to be read is one nothing may be written in: the copy here would stop
 *  being the space's, and the sync would refuse the change on every pass. So they are
 *  not offered there, exactly as the file list's menu offers nothing to make there. */

const readOnly = new Set<string>()

vi.mock('./sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const { workspace } = await import('./workspace.svelte')
const { appCommands } = await import('./commands')

const SPACE = '/Theirs'
const MAKING = ['new-unique', 'new-canvas', 'new-pages', 'new-database', 'new-from-template']

function offered(): string[] {
  vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({
    id: 'theirs',
    name: 'Theirs',
    root: SPACE,
  })
  return appCommands()
    .filter((one) => MAKING.includes(one.id) && one.disabled !== true)
    .map((one) => one.id)
}

afterEach(() => {
  vi.restoreAllMocks()
  readOnly.clear()
})

describe('making a file from the palette', () => {
  test('is offered in a space that may be written in', () => {
    expect(offered()).toEqual(MAKING)
  })

  test('is not offered in a space shared to be read', () => {
    readOnly.add(SPACE)
    expect(offered()).toEqual([])
  })
})

/** The palette's rows about the note in front, in a space shared to be read: renaming
 *  it and moving it both write there, so neither is offered (B273). */
describe('the note in front', () => {
  const NOTE = `${SPACE}/Plan.md`

  function rows() {
    vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({
      id: 'theirs',
      name: 'Theirs',
      root: SPACE,
    })
    vi.spyOn(workspace, 'active', 'get').mockReturnValue({
      id: 'plan',
      kind: 'note',
      path: NOTE,
      doc: '',
      name: 'Plan.md',
      note: { path: NOTE, kind: 'note', text: '', latest: '' },
    } as never)
    vi.spyOn(workspace, 'canRenameFromTab').mockReturnValue(true)
    vi.spyOn(workspace, 'shownSpaces', 'get').mockReturnValue([
      { id: 'theirs', name: 'Theirs', root: SPACE },
      { id: 'mine', name: 'Mine', root: '/Mine' },
    ])
    workspace.spaces = [
      { id: 'theirs', name: 'Theirs', root: SPACE },
      { id: 'mine', name: 'Mine', root: '/Mine' },
    ]
    const commands = appCommands()
    return {
      renames: commands.some((one) => one.id === 'rename' && one.disabled !== true),
      moves: commands.some((one) => one.id === 'move-note'),
    }
  }

  test('is renamed and moved in a space that may be written in', () => {
    expect(rows()).toEqual({ renames: true, moves: true })
  })

  test('is neither in a space shared to be read', () => {
    readOnly.add(SPACE)
    expect(rows()).toEqual({ renames: false, moves: false })
  })
})

/** Converting a space's old website notes writes a shortcut beside each and puts the
 *  note in the trash, so a space shared to be read is not offered it (B288). */
describe('converting website notes', () => {
  async function offers(): Promise<boolean> {
    const { links } = await import('./link-index.svelte')
    vi.spyOn(links, 'websiteNotes', 'get').mockReturnValue(true)
    vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({
      id: 'theirs',
      name: 'Theirs',
      root: SPACE,
    })
    return appCommands().some((one) => one.id === 'convert-website-notes' && one.disabled !== true)
  }

  test('is offered in a space that may be written in', async () => {
    expect(await offers()).toBe(true)
  })

  test('is not offered in a space shared to be read', async () => {
    readOnly.add(SPACE)
    expect(await offers()).toBe(false)
  })
})
