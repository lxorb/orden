import { beforeEach, describe, expect, test, vi } from 'vitest'

const FILES: Record<string, string> = {
  '/Work/Plan.md': '---\nicon: rocket\nicon-color: violet\n---\n# Plan\n',
  '/Home/Plan.md': '---\nicon: house\n---\n# Plan\n',
  '/Work/Team.chat':
    '{"v":1,"chat":"c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e","icon":"rocket","iconColor":"violet"}\n',
  '/Home/Plain.chat': '{"v":1,"chat":"c_0f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e"}\n',
  '/Home/Docs.url':
    '[InternetShortcut]\r\nURL=https://docs.dev/\r\nTitle=Docs\r\nNib-Icon=data:image/png;base64,AA\r\n',
  '/Home/Chosen.url':
    '[InternetShortcut]\r\nURL=https://docs.dev/\r\nNib-Icon=data:image/png;base64,AA\r\nNib-Chosen-Icon=rocket\r\n',
  '/Home/Lecture.pages': '{"nodes":[],"edges":[]}',
  '/Home/Sketch.pages': '{"nodes":[],"edges":[]}',
  '/Home/Blank.md': '# Blank\n\n',
  '/Home/Written.md': '# Written\n\nWords.\n',
}

const KEPT: Record<string, Record<string, string>> = {}

const PAPERS = new Set(['/Home/Lecture.pages.pdf'])
const asked: string[] = []

const index: {
  root: string
  icons: Record<string, string>
  tints: Record<string, string>
  bare: Set<string>
} = {
  root: '/Work',
  icons: {},
  tints: {},
  bare: new Set(['Empty.md', 'Box/Box.md', 'Lone/Lone.md']),
}
const reads: string[] = []

const relative = (path: string) =>
  path.startsWith(`${index.root}/`) ? path.slice(index.root.length + 1) : path

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string, args: { path?: string; root?: string } = {}) => {
    if (command === 'file_stamp' || command === 'path_exists') {
      asked.push(String(args.path))
      const there = PAPERS.has(String(args.path))
      return Promise.resolve(command === 'path_exists' ? there : there ? {} : null)
    }
    if (command !== 'read_note') return Promise.resolve(undefined)
    reads.push(String(args.path))
    const held = FILES[String(args.path)]
    return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
  },
}))

vi.mock('./link-index.svelte', () => ({
  links: {
    rootOf: () => index.root,
    iconOf: (path: string) => index.icons[relative(path)] ?? null,
    tintOf: (path: string) => index.tints[relative(path)] ?? null,
    saysNothing: (path: string) => index.bare.has(relative(path)),
    faviconOf: () => null,
    shortcutOf: () => null,
  },
}))

const live: Record<string, string> = {}

vi.mock('./web-tab/pages.svelte', () => ({
  pages: { iconOf: (tab: string) => live[tab] ?? null },
  siteMark: (shown: string | null, _url: string | null, written?: string | null) =>
    shown ?? written ?? null,
}))

const file = (path: string) => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: false,
  children: [],
})
const folder = (path: string, ...children: ReturnType<typeof file>[]) => ({
  name: path.split('/').pop() ?? path,
  path,
  is_dir: true,
  children,
})

const FOLDERS: Record<string, ReturnType<typeof folder>> = {
  '/Work/Box': folder('/Work/Box', file('/Work/Box/Box.md'), file('/Work/Box/Inside.md')),
  '/Work/Lone': folder('/Work/Lone', file('/Work/Lone/Lone.md')),
  '/Work/Vault': folder('/Work/Vault', file('/Work/Vault/Loose.md')),
  '/Work/Hollow': folder('/Work/Hollow'),
}

const tabs: { kind: string; path: string | null; id: string }[] = []

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'w', name: 'Work', root: '/Work' },
      { id: 'h', name: 'Home', root: '/Home' },
    ],
    get activeSpace() {
      return { root: index.root }
    },
    folderIcons: { iconOf: () => null, tintOf: () => null },
    itemMeta: { of: (path: string) => KEPT[path] ?? null },
    tabs,
    entryAt: (path: string) =>
      path === '/Work/Made.pages'
        ? { path, paper: true }
        : path === '/Work/Blank.pages'
          ? { path }
          : (FOLDERS[path] ?? null),
  },
}))

const { chosenIcon, chosenTint, faviconFor, holdsPaper, sourceMark } = await import('./chosen-icon')
const { elsewhere } = await import('./marks-elsewhere.svelte')
const { NoteDoc, Tab } = await import('./workspace/documents.svelte')

function tabAt(path: string) {
  const doc = new NoteDoc(
    { kind: 'note', path, name: 'Plan.md', text: '', dirty: false },
    () => undefined,
  )
  return new Tab(doc, 'pane')
}

function open(root: string) {
  index.root = root
  index.icons = root === '/Work' ? { 'Plan.md': 'rocket' } : { 'Plan.md': 'house' }
  index.tints = root === '/Work' ? { 'Plan.md': 'violet' } : {}
  elsewhere.clear()
}

async function settled<T>(ask: () => T): Promise<T> {
  ask()
  await vi.waitFor(() => expect(ask()).not.toBeNull())
  return ask()
}

beforeEach(() => {
  reads.length = 0
})

describe("a note's own metadata (#1210)", () => {
  test('is the icon and colour it wears, over what its front matter still says', () => {
    open('/Work')
    KEPT['/Work/Plan.md'] = { icon: 'star', 'icon-color': 'red' }
    expect(chosenIcon('/Work/Plan.md')).toBe('star')
    expect(chosenTint('/Work/Plan.md')).toBe('red')

    KEPT['/Work/Plan.md'] = { cover: 'sea.png' }
    expect(chosenIcon('/Work/Plan.md')).toBe('rocket')
    delete KEPT['/Work/Plan.md']
  })
})

describe('two spaces with a tab each', () => {
  const work = tabAt('/Work/Plan.md')
  const home = tabAt('/Home/Plan.md')

  test('each tab wears its own icon while Work is open', async () => {
    open('/Work')

    expect(chosenIcon(work.path ?? '')).toBe('rocket')
    expect(chosenTint(work.path ?? '')).toBe('violet')
    expect(await settled(() => chosenIcon(home.path ?? ''))).toBe('house')
    expect(reads).toEqual(['/Home/Plan.md'])
  })

  test('and the same while Home is open', async () => {
    open('/Home')

    expect(chosenIcon(home.path ?? '')).toBe('house')
    expect(await settled(() => chosenIcon(work.path ?? ''))).toBe('rocket')
    expect(chosenTint(work.path ?? '')).toBe('violet')
  })

  test('a file of another space is read once, however often it is asked about', async () => {
    open('/Work')

    await settled(() => chosenIcon(home.path ?? ''))
    chosenIcon(home.path ?? '')
    chosenTint(home.path ?? '')

    expect(reads).toEqual(['/Home/Plan.md'])
  })

  test('a website of another space wears the mark its file wrote down', async () => {
    open('/Work')

    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,AA')
  })

  test('a website wears the icon chosen for it over its own mark', async () => {
    open('/Work')

    expect(await settled(() => chosenIcon('/Home/Chosen.url'))).toBe('rocket')
    expect(faviconFor('/Home/Chosen.url')).toBeNull()
    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,AA')
  })

  test('a website open in a tab wears the mark the tab wears now', async () => {
    open('/Work')
    tabs.push({ kind: 'web', path: '/Home/Docs.url', id: 't1' })
    live.t1 = 'data:image/png;base64,BADGE'

    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,BADGE')
    tabs.length = 0
    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,AA')
  })

  test('a save in another space is what its mark says next', async () => {
    open('/Work')
    await settled(() => chosenIcon(home.path ?? ''))

    elsewhere.saved('/Home/Plan.md', '---\nicon: tree\n---\n')

    await vi.waitFor(() => expect(chosenIcon(home.path ?? '')).toBe('tree'))
  })
})

describe('a chat', () => {
  test('wears the icon and the colour its pointer says, in the open space too', async () => {
    open('/Work')

    expect(await settled(() => chosenIcon('/Work/Team.chat'))).toBe('rocket')
    expect(chosenTint('/Work/Team.chat')).toBe('violet')
    expect(reads).toEqual(['/Work/Team.chat'])
  })

  test('and one that chose nothing wears nothing, read once however often it is asked', async () => {
    open('/Work')

    chosenIcon('/Home/Plain.chat')
    await vi.waitFor(() => expect(reads).toEqual(['/Home/Plain.chat']))
    expect(chosenIcon('/Home/Plain.chat')).toBeNull()
    expect(chosenTint('/Home/Plain.chat')).toBeNull()
    expect(reads).toEqual(['/Home/Plain.chat'])
  })

  test('a pointer written again is what its mark says next', async () => {
    open('/Work')
    await settled(() => chosenIcon('/Work/Team.chat'))

    elsewhere.saved('/Work/Team.chat', '{"v":1,"chat":"c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e"}\n')

    await vi.waitFor(() => expect(chosenIcon('/Work/Team.chat')).toBeNull())
    expect(chosenTint('/Work/Team.chat')).toBeNull()
  })
})

describe('a page note made from a PDF', () => {
  test('in the open space is known from its listing, with nothing asked of the disk', () => {
    open('/Work')
    asked.length = 0

    expect(holdsPaper('/Work/Made.pages')).toBe(true)
    expect(holdsPaper('/Work/Blank.pages')).toBe(false)
    expect(asked).toEqual([])
  })

  test('in another space is asked of the disk, once', async () => {
    open('/Work')
    asked.length = 0

    holdsPaper('/Home/Lecture.pages')
    await vi.waitFor(() => expect(holdsPaper('/Home/Lecture.pages')).toBe(true))
    holdsPaper('/Home/Lecture.pages')
    expect(asked.filter((one) => one === '/Home/Lecture.pages.pdf')).toHaveLength(1)
  })

  test('and one started blank there wears its own mark', async () => {
    open('/Work')
    asked.length = 0

    holdsPaper('/Home/Sketch.pages')
    await vi.waitFor(() => expect(asked).toContain('/Home/Sketch.pages.pdf'))
    await vi.waitFor(() => expect(reads).toContain('/Home/Sketch.pages'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(holdsPaper('/Home/Sketch.pages')).toBe(false)
  })

  test('wears the PDF s mark, and nothing else does', () => {
    open('/Work')

    expect(sourceMark('pages', '/Work/Made.pages').mark).toBe('pdf')
    expect(sourceMark('pages', '/Work/Blank.pages').mark).toBe('pages')
    expect(sourceMark('pages', undefined).mark).toBe('pages')
    expect(sourceMark('note', '/Work/Made.pages').mark).toBe('note')
    expect(sourceMark('pdf', '/Work/Paper.pdf').mark).toBe('pdf')
    expect(sourceMark('pages', '/Work/Made.pages').icon).toBeNull()
  })

  test('a website wears its brand s logo by its address, and nothing else does', () => {
    open('/Work')

    expect(sourceMark('web', undefined, 'https://github.com/lxorb/orden')).toEqual({
      mark: 'web',
      icon: 'simple-icons:github',
    })
    expect(sourceMark('web', undefined, 'https://chatgpt.com/').icon).toBe('simple-icons:openai')
    expect(sourceMark('web', undefined, 'not an address').icon).toBeNull()
    expect(sourceMark('note', '/Work/Plan.md', 'https://github.com/').icon).toBeNull()
  })

  test('a note that says nothing yet wears the empty page, or the folder', () => {
    open('/Work')

    expect(sourceMark('note', '/Work/Empty.md').mark).toBe('file')
    expect(sourceMark('note', '/Work/Plan.md').mark).toBe('note')
    expect(sourceMark('note', '/Work/Box/Box.md').mark).toBe('folder')
    expect(sourceMark('note', '/Work/Lone/Lone.md').mark).toBe('file')
    expect(sourceMark('file', '/Work/Vault').mark).toBe('folder')
    expect(sourceMark('file', '/Work/Hollow').mark).toBe('file')
    expect(sourceMark('file', '/Work/Notes.md.bak').mark).toBe('file')
    expect(sourceMark('note', undefined).mark).toBe('note')
    expect(sourceMark('canvas', '/Work/Empty.md').mark).toBe('canvas')
  })

  test('and a note of another space, out of what its file says', async () => {
    open('/Work')

    sourceMark('note', '/Home/Blank.md')
    sourceMark('note', '/Home/Written.md')
    await vi.waitFor(() => expect(sourceMark('note', '/Home/Blank.md').mark).toBe('file'))
    await vi.waitFor(() => expect(reads).toContain('/Home/Written.md'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sourceMark('note', '/Home/Written.md').mark).toBe('note')
  })

  test('a file that is not a page note is never asked about', () => {
    open('/Work')
    asked.length = 0

    expect(holdsPaper('/Home/Plan.md')).toBe(false)
    expect(asked).toEqual([])
  })
})
