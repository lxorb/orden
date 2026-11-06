import { beforeEach, describe, expect, test, vi } from 'vitest'

const readOnly = new Set<string>()
vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const trashed: string[] = []
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: { path: string }) => {
    if (command === 'trash_words') trashed.push(args.path)
    return Promise.resolve({ id: 'one' })
  },
}))

const { trashWords } = await import('./placing')

const theirs = { id: 'theirs', name: 'Theirs', root: '/Theirs' }
const mine = { id: 'mine', name: 'Mine', root: '/Mine' }

function places(spaces: (typeof theirs)[]) {
  return {
    spaces,
    activeSpace: theirs,
    closed: { stack: [] },
    persist: () => undefined,
  } as never
}

const draft = {
  key: 'k',
  home: 'theirs',
  kind: 'note',
  name: 'Ideas.md',
  path: null,
  shared: null,
  text: '# Ideas\n\nsome words',
} as never

beforeEach(() => {
  readOnly.clear()
  trashed.length = 0
})

describe("a closed draft's words", () => {
  test('go under the root of their own space', async () => {
    await trashWords(places([theirs, mine]), draft)
    expect(trashed[0]?.startsWith('/Theirs/')).toBe(true)
  })

  test('go under a space that may be written in, where theirs is shared to be read', async () => {
    readOnly.add('/Theirs')
    await trashWords(places([theirs, mine]), draft)
    expect(trashed[0]?.startsWith('/Mine/')).toBe(true)
  })

  test('and are still kept where no space may be written in', async () => {
    readOnly.add('/Theirs')
    await trashWords(places([theirs]), draft)
    expect(trashed).toHaveLength(1)
  })
})
