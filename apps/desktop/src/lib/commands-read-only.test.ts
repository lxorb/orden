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
