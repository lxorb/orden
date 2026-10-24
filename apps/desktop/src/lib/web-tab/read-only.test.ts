import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Websites in a space shared with this account to be read (B288).
 *
 *  Opening one, typing an address into its bar and opening a website written in the
 *  old format all used to write the file: the address, a shortcut beside the note,
 *  the note put in the trash. A space shared to be read is one nothing may be written
 *  in - the copy here would stop being the space's, and the sync refuses it on every
 *  pass - so a website there browses as a tab with no file does, and its file stays
 *  as the owner left it.
 *
 *  Two spaces on a map of a disk, as read-only-files.test.ts has them, and every
 *  command the disk is asked is logged, so a refusal can be told from a write that
 *  failed. */

const files = new Map<string, string>()
const asked: string[] = []
const readOnly = vi.hoisted(() => new Set<string>())

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const ROOTS = ['/theirs', '/mine']

function listing(root: string) {
  const children = [...files.keys()]
    .filter((one) => one.startsWith(`${root}/`))
    .map((one) => ({
      name: one.split('/').pop() ?? one,
      path: one,
      is_dir: false,
      modified: 0,
      created: 0,
      children: [],
    }))
  return { name: root.slice(1), path: root, is_dir: true, modified: 0, created: 0, children }
}

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    asked.push(command)
    const path = text(args?.path)
    switch (command) {
      case 'read_note': {
        const held = files.get(path)
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'rename_note': {
        const from = text(args?.from)
        const held = files.get(from)
        if (held === undefined) throw new Error(`no such note: ${from}`)
        files.delete(from)
        files.set(text(args?.to), held)
        return undefined
      }
      case 'delete_note':
        files.delete(path)
        return undefined
      case 'trash_item':
        files.delete(path)
        return { id: 't' }
      case 'read_tree': {
        // As the crate does: a root that is not a folder is refused.
        const root = text(args?.root)
        if (!ROOTS.includes(root)) throw new Error('root is not a directory')
        return listing(root)
      }
      case 'file_stamp':
        return files.has(path) ? { modified: 1, len: 1 } : null
      default:
        return undefined
    }
  },
}))

vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
const { pages } = await import('./pages.svelte')

/** What the disk was asked to change, rather than to say. */
const WRITES = /write|rename|delete|trash|copy|create|move|snapshot|bring|remove/
const writes = () => asked.filter((command) => WRITES.test(command))

const SHORTCUT =
  '[InternetShortcut]\r\nURL=https://svelte.dev/docs\r\n' +
  'Title=Svelte docs\r\nNib-Added=2026-09-12T08:30:00.000Z\r\n'
/** A website as an older nib wrote one: a note with the address in its front matter. */
const OLD = '---\nurl: https://kit.svelte.dev/\n---\n\n# Kit\n\n<https://kit.svelte.dev/>\n'

beforeEach(async () => {
  vi.restoreAllMocks()
  files.clear()
  files.set('/theirs/Svelte docs.url', SHORTCUT)
  files.set('/theirs/Kit.md', OLD)
  files.set('/mine/Kit.md', OLD)
  readOnly.clear()
  workspace.spaces = [
    { id: 'theirs', name: 'Theirs', root: '/theirs' },
    { id: 'mine', name: 'Mine', root: '/mine' },
  ]
  workspace.activeSpaceId = 'theirs'
  workspace.tabs = []
  await workspace.loadTree()
  asked.length = 0
})

const before = () => [...files.entries()].sort()

describe('in a space that may be written in', () => {
  test('an address typed into the bar is where the file points', async () => {
    await workspace.openWeb('/theirs/Svelte docs.url')
    const tab = workspace.tabs.find((one) => one.path === '/theirs/Svelte docs.url')
    if (!tab) throw new Error('no tab')

    await workspace.webAimed(tab, 'https://svelte.dev/tutorial')

    expect(files.get('/theirs/Svelte docs.url')).toContain('URL=https://svelte.dev/tutorial')
  })

  test('a website in the old format becomes a shortcut', async () => {
    workspace.activeSpaceId = 'mine'
    await workspace.loadTree()

    await workspace.openWeb('/mine/Kit.md')

    expect(files.has('/mine/Kit.url')).toBe(true)
    expect(files.has('/mine/Kit.md')).toBe(false)
  })
})

describe('in a space shared to be read', () => {
  beforeEach(() => {
    readOnly.add('/theirs')
  })

  test('an address typed into the bar goes there and writes nothing', async () => {
    await workspace.openWeb('/theirs/Svelte docs.url')
    const tab = workspace.tabs.find((one) => one.path === '/theirs/Svelte docs.url')
    if (!tab) throw new Error('no tab')
    const was = before()

    await workspace.webAimed(tab, 'https://svelte.dev/tutorial')

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
    expect(tab.doc).toBe(SHORTCUT)
  })

  test('a website in the old format opens where it points, and stays as it is', async () => {
    const was = before()

    await workspace.openWeb('/theirs/Kit.md')

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
    const tab = workspace.tabs.find((one) => one.kind === 'web')
    expect(tab?.path).toBeNull()
    expect(tab && pages.of(tab.id).url).toBe('https://kit.svelte.dev/')
  })

  test('converting the space writes nothing', async () => {
    // What the index says of the space's notes, which a unit test has not scanned.
    const { links } = await import('../link-index.svelte')
    vi.spyOn(links, 'urlOf').mockImplementation((path) =>
      path.endsWith('Kit.md') ? 'https://kit.svelte.dev/' : null,
    )
    const was = before()

    expect(await workspace.convertWebsites()).toBe(0)

    expect(before()).toEqual(was)
    expect(writes()).toEqual([])
  })
})
