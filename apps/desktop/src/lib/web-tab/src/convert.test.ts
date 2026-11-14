import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const sent: { command: string; path: string; content: string }[] = []
const disk = new Map<string, string>()
const told: string[] = []
let signedIn = true
const open = new Set<string>()

vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })

    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'path_exists') return Promise.resolve(disk.has(path))
    if (command === 'write_note') disk.set(path, content)
    if (command === 'delete_note' || command === 'trash_item') disk.delete(path)
    return Promise.resolve('')
  },
  isNative: false,
  joinPath: (dir: string, relative: string) => (dir ? `${dir}/${relative}` : relative),
}))

vi.mock('../../accounts/src/account.svelte', () => ({
  account: {
    get signedIn() {
      return signedIn
    },
  },
}))

vi.mock('../../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string) => void told.push(`saved ${path}`),
    urlOf: (path: string) => (disk.get(path)?.includes('url:') ? 'https://x' : null),
  },
}))

const { asShortcut, convertWebsites } = await import('./convert')
type Converts = import('./convert').Converts
type Entry = import('../../workspace.svelte').Entry
type NoteDoc = import('../../workspace/documents.svelte').NoteDoc

const SPACE = '/space'

function urlNote(url: string, title: string, extra = ''): string {
  const front = `---\nurl: ${url}\ntitle: ${title}\n---\n`
  const body = `# ${title}\n\n<${url}>\n`
  return front + body + extra
}

const binned: string[] = []

function store(notes: Record<string, string>) {
  disk.clear()
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)

  const shown: string[] = []
  const ws = {
    notes: Object.keys(notes).map((path) => ({ path, name: path.split('/').pop() ?? path })),
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    entryAt: (path: string) => (disk.has(path) ? ({ path } as Entry) : null),
    documentAt: (path: string) => (open.has(path) ? ({ path } as unknown as NoteDoc) : null),
    freeNameOnDisk: async (dir: string, wanted: string) => {
      let at = 1
      let name = wanted
      while (disk.has(dir ? `${dir}/${name}` : name)) {
        at += 1
        name = wanted.replace(/(\.[^.]+)?$/, ` ${at}$1`)
      }
      return name
    },
    showEntry: (entry: Entry) => void shown.push(entry.path),
    freshEntry: (path: string, isFolder: boolean) => ({ path, is_dir: isFolder }) as Entry,
    fileGone: (path: string) => {
      told.push(`gone ${path}`)
      return Promise.resolve()
    },
    loadTree: () => Promise.resolve(),
    bin: (path: string) => {
      binned.push(path)
      disk.delete(path)
      return Promise.resolve(null)
    },
  }

  return { ws: ws as unknown as Converts, shown }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  open.clear()
  signedIn = true
})

afterEach(() => vi.restoreAllMocks())

describe('a note that is a website', () => {
  const NOTE = `${SPACE}/Svelte docs.md`

  test('is written as a shortcut beside it, and the note goes', async () => {
    const { ws, shown } = store({ [NOTE]: urlNote('https://svelte.dev', 'Svelte docs') })

    const target = await asShortcut(ws, NOTE)

    expect(target).toBe(`${SPACE}/Svelte docs.url`)
    expect(disk.get(target ?? '')).toContain('URL=https://svelte.dev')
    expect(disk.has(NOTE)).toBe(false)
    expect(shown).toEqual([`${SPACE}/Svelte docs.url`])
    expect(told).toEqual([`saved ${SPACE}/Svelte docs.url`, `gone ${NOTE}`])
  })

  test('and its file goes the way a deleted note goes', async () => {
    binned.length = 0
    const made = store({ [NOTE]: urlNote('https://svelte.dev', 'Svelte docs') })
    await asShortcut(made.ws, NOTE)

    expect(binned).toEqual([NOTE])
    expect(sent.map((one) => one.command)).not.toContain('delete_note')
  })
})

describe('a note in a space that is not on screen', () => {
  const NOTE = `${SPACE}/Svelte docs.md`

  test('steps past a file of the same name the listing here has not read', async () => {
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte docs'),
      [`${SPACE}/Svelte docs.url`]: "somebody else's file",
    })
    const away = { ...ws, entryAt: () => null } as Converts

    const target = await asShortcut(away, NOTE)

    expect(target).toBe(`${SPACE}/Svelte docs 2.url`)
    expect(disk.get(`${SPACE}/Svelte docs.url`)).toBe("somebody else's file")
  })
})

describe('a note that only looks like one', () => {
  test('is left alone when it has no url', async () => {
    const NOTE = `${SPACE}/Plan.md`
    const { ws, shown } = store({ [NOTE]: '# Plan\n\njust words\n' })

    expect(await asShortcut(ws, NOTE)).toBeNull()
    expect(disk.get(NOTE)).toBe('# Plan\n\njust words\n')
    expect(shown).toEqual([])
    expect(told).toEqual([])
  })

  test('and a note that is not there at all', async () => {
    const { ws } = store({})
    expect(await asShortcut(ws, `${SPACE}/gone.md`)).toBeNull()
  })
})

describe('a note somebody also wrote in', () => {
  const NOTE = `${SPACE}/Svelte.md`

  test('stays a note with the url line taken out, beside its new shortcut', async () => {
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte', '\nMy own notes on it.\n'),
    })

    const target = await asShortcut(ws, NOTE)

    expect(disk.has(target ?? '')).toBe(true)
    expect(disk.has(NOTE)).toBe(true)
    expect(disk.get(NOTE)).toContain('My own notes on it.')
    expect(disk.get(NOTE)).not.toContain('url: https://svelte.dev')
    expect(told).toEqual([`saved ${target}`, `saved ${NOTE}`])
  })
})

describe('a shortcut name already taken', () => {
  test('the note keeps its own name, stepped aside', async () => {
    const NOTE = `${SPACE}/Svelte docs.md`
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte docs'),
      [`${SPACE}/Svelte docs.url`]: 'a shortcut somebody else put here',
    })

    const target = await asShortcut(ws, NOTE)

    expect(target).toBe(`${SPACE}/Svelte docs 2.url`)
    expect(disk.get(`${SPACE}/Svelte docs.url`)).toBe('a shortcut somebody else put here')
  })

  test('the shortcut it would become is that shortcut already, so no second one', async () => {
    const NOTE = `${SPACE}/Svelte docs.md`
    const SHORTCUT = `${SPACE}/Svelte docs.url`
    const there = '[InternetShortcut]\r\nURL=https://www.svelte.dev/docs\r\nTitle=Svelte docs\r\n'
    const { ws, shown } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte docs'),
      [SHORTCUT]: there,
    })

    const target = await asShortcut(ws, NOTE)

    expect(target).toBe(SHORTCUT)
    expect(disk.get(SHORTCUT)).toBe(there)
    expect(disk.has(`${SPACE}/Svelte docs 2.url`)).toBe(false)
    expect(disk.has(NOTE)).toBe(false)
    expect(shown).toEqual([])
  })
})

describe('converting a whole space', () => {
  test('turns every url-note into a shortcut and counts them', async () => {
    const { ws } = store({
      [`${SPACE}/A.md`]: urlNote('https://a.dev', 'A'),
      [`${SPACE}/B.md`]: urlNote('https://b.dev', 'B'),
      [`${SPACE}/Plan.md`]: '# Plan\n\nwords\n',
    })

    expect(await convertWebsites(ws)).toBe(2)
    expect(disk.has(`${SPACE}/A.url`)).toBe(true)
    expect(disk.has(`${SPACE}/B.url`)).toBe(true)
    expect(disk.has(`${SPACE}/Plan.md`)).toBe(true)
  })

  test('and does nothing where there is no open space', async () => {
    const { ws } = store({ [`${SPACE}/A.md`]: urlNote('https://a.dev', 'A') })
    ;(ws as { activeSpace: unknown }).activeSpace = null

    expect(await convertWebsites(ws)).toBe(0)
    expect(sent).toEqual([])
  })
})

describe('a website a document is open on', () => {
  const NOTE = `${SPACE}/Open.md`

  test('is left exactly as it is, file and all', async () => {
    const { ws, shown } = store({ [NOTE]: urlNote('https://svelte.dev', 'Open') })
    open.add(NOTE)

    expect(await asShortcut(ws, NOTE)).toBeNull()
    expect(disk.has(NOTE)).toBe(true)
    expect(disk.has(`${SPACE}/Open.url`)).toBe(false)
    expect(shown).toEqual([])
    expect(sent).toEqual([])
    expect(told).toEqual([])
  })

  test('and a pass over the space converts the rest and steps around it', async () => {
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Open'),
      [`${SPACE}/A.md`]: urlNote('https://a.dev', 'A'),
    })
    open.add(NOTE)

    expect(await convertWebsites(ws)).toBe(1)
    expect(disk.has(`${SPACE}/A.url`)).toBe(true)
    expect(disk.has(`${SPACE}/Open.url`)).toBe(false)
    expect(disk.get(NOTE)).toContain('url: https://svelte.dev')
  })
})
