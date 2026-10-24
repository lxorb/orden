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

/** Convert syntax rewrites notes of the space in front, which one shared to be read
 *  refuses (B274). */
describe('converting syntax', () => {
  const offers = () => {
    vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({
      id: 'theirs',
      name: 'Theirs',
      root: SPACE,
    })
    return appCommands().some((one) => one.id === 'convert-syntax' && one.disabled !== true)
  }

  test('is offered in a space that may be written in, and not in one shared to be read', () => {
    expect(offers()).toBe(true)
    readOnly.add(SPACE)
    expect(offers()).toBe(false)
  })
})
