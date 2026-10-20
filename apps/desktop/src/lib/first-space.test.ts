import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A fresh start: the first space, made without a question, open on the welcome note.
 *
 *  Emil, 2026-10-13: "rather welcome note instead of the where do your notes come
 *  from". The note is the one the browser build has always given a first visit, once
 *  per device by the same rule: a reader who has been introduced is not introduced
 *  again, and an untouched welcome never travels to an account. See welcome.ts. */

const notes = new Map<string, string>()
const made: { name: string; path: string }[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'create_space': {
        const space = { name: text(args?.name), path: `/spaces/${text(args?.name)}` }
        made.push(space)
        return space
      }
      case 'list_spaces':
        return made
      case 'read_tree': {
        const root = made.at(-1)?.path ?? '/spaces'
        const children = [...notes.keys()]
          .filter((one) => one.startsWith(`${root}/`))
          .map((one) => ({
            name: one.slice(root.length + 1),
            path: one,
            is_dir: false,
            modified: 0,
            created: 0,
            children: [],
          }))
        return { name: 'space', path: root, is_dir: true, modified: 0, created: 0, children }
      }
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      default:
        return undefined
    }
  },
}))

// A pass is nudged once a space is made; nothing here is about syncing.
vi.mock('./sync.svelte', () => ({ sync: { nudge: () => undefined } }))

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

const { workspace } = await import('./workspace.svelte')
const { firstSpace } = await import('./first-space.svelte')
const { insideFolder, pickedFolder } = await import('./import/sources')
const { WELCOME, WELCOME_NAME, WELCOME_SPACE, isUntouchedWelcome } = await import('./welcome')
const { AGENTS_NAME, AGENTS_SEED, isUntouchedAgents } = await import('./agents-seed')

/** A desktop with no space, nothing open and nobody signed in. */
const FRESH = {
  native: true,
  plugin: false,
  restored: true,
  spaces: 0,
  restoring: false,
  signedIn: false,
  invited: false,
  tabs: 0,
}

beforeEach(() => {
  notes.clear()
  made.length = 0
  localStorage.clear()
  workspace.spaces = []
  workspace.activeSpaceId = null
  workspace.tree = null
  workspace.tabs = []
})

describe('a fresh start', () => {
  const welcome = `/spaces/${WELCOME_SPACE}/${WELCOME_NAME}`

  test('makes the first space and opens it on the welcome note', async () => {
    await firstSpace.start(FRESH)

    expect(workspace.spaces.map((one) => one.name)).toEqual([WELCOME_SPACE])
    expect(notes.get(welcome)).toBe(WELCOME)
    expect(workspace.active?.path).toBe(welcome)
  })

  /** The page the app was opened for is taken while the space is still being made. */
  test('leaves a page the app was opened with in front, the note behind it', async () => {
    const starting = firstSpace.start(FRESH)
    const page = workspace.openPage('https://example.com/', 'front')
    await starting

    expect(workspace.active?.id).toBe(page)
    expect(workspace.tabs.map((one) => one.path)).toContain(welcome)
  })

  test('asks nothing, and makes one space however often it is asked at once', async () => {
    await Promise.all([firstSpace.start(FRESH), firstSpace.start(FRESH)])

    expect(made).toHaveLength(1)
  })

  test('makes nothing where the moment is not a fresh start', async () => {
    await firstSpace.start({ ...FRESH, signedIn: true })

    expect(made).toEqual([])
  })

  test('makes nothing once there is a space', async () => {
    await firstSpace.start(FRESH)
    await firstSpace.start(FRESH)

    expect(made).toHaveLength(1)
  })

  test('on a device introduced before, a space and no welcome note', async () => {
    localStorage.setItem('nib:seeded', 'yes')

    await firstSpace.start(FRESH)

    expect(workspace.spaces).toHaveLength(1)
    expect(notes.has(welcome)).toBe(false)
  })

  /** Every space made from here starts with the few lines an assistant working in it
   *  is to read; see agents-seed.ts. */
  test('and the space gets its AGENTS.md', async () => {
    await firstSpace.start(FRESH)

    expect(notes.get(`/spaces/${WELCOME_SPACE}/${AGENTS_NAME}`)).toBe(AGENTS_SEED)
  })
})

describe('the AGENTS.md, untouched', () => {
  test('is not writing, but one word in it is', () => {
    expect(isUntouchedAgents(`/spaces/Journal/${AGENTS_NAME}`, AGENTS_SEED)).toBe(true)
    expect(isUntouchedAgents(`/spaces/Journal/${AGENTS_NAME}`, `${AGENTS_SEED}- tea\n`)).toBe(false)
    expect(isUntouchedAgents(`/spaces/Journal/Other.md`, AGENTS_SEED)).toBe(false)
  })
})

describe('the welcome note, untouched', () => {
  test('is not writing, so it never travels', () => {
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, WELCOME)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, `${WELCOME}mine\n`)).toBe(false)
  })

  /** A browser seeded before the words stopped saying "browser" still has the old
   *  ones, and they are no more the reader's writing now than they were then. */
  test('nor is the one an earlier version wrote', () => {
    const earlier = [
      '# Welcome to Nib',
      '',
      'This is the browser version. Your notes live in this browser until you sign in',
      'and turn on syncing, and then they follow you everywhere.',
      '',
      '- Everything is markdown, and nothing else',
      '- **Bold**, *italic*, ==highlight==, `code`',
      '- $E = mc^2$ renders as you type',
      '',
      '```js',
      "const hello = 'world'",
      '```',
      '',
      '| What | Where |',
      '| ---- | ----- |',
      '| Notes | this browser |',
      '| Synced notes | your account |',
      '',
    ].join('\n')

    expect(isUntouchedWelcome(`/Notes/${WELCOME_NAME}`, earlier)).toBe(true)
  })

  /** Every device seeded before the app was called Orden holds one of these, under
   *  either earlier name, and they are still the app's, not the reader's. */
  test.each(['Nib', 'nibeditor'])('nor the one written while it was called %s', (name) => {
    const earlier = [
      `# Welcome to ${name}`,
      '',
      'Your notes live on this device until you sign in',
      'and turn on syncing, and then they follow you everywhere.',
      '',
      '- Everything is markdown, and nothing else',
      '- **Bold**, *italic*, ==highlight==, `code`',
      '- $E = mc^2$ renders as you type',
      '',
      '```js',
      "const hello = 'world'",
      '```',
      '',
      '| What | Where |',
      '| ---- | ----- |',
      '| Notes | this device |',
      '| Synced notes | your account |',
      '',
    ].join('\n')

    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, earlier)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, `${earlier}mine\n`)).toBe(false)
  })

  /** Every seed before the welcome note linked to Settings > Import was written
   *  without that line, and is no more the reader's writing for missing it. */
  test('nor the one written before it linked to Import', () => {
    const before = WELCOME.replace(
      '\n[Import from Obsidian or Notion](nib://settings/import)\n',
      '',
    )

    expect(before).not.toBe(WELCOME)
    expect(isUntouchedWelcome(`/spaces/Notes/${WELCOME_NAME}`, before)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Notes/${WELCOME_NAME}`, `${before}mine\n`)).toBe(false)
  })

  test('points to Settings > Import, where notes from another app come in', () => {
    expect(WELCOME).toContain('](nib://settings/import)')
  })

  test('says nothing about which build it is in', () => {
    expect(WELCOME).not.toMatch(/browser/i)
  })

  test('says the name the app goes by', () => {
    expect(WELCOME.split('\n')[0]).toBe('# Welcome to Orden')
  })
})

describe('a folder brought in as a space', () => {
  const picked = (path: string) => ({
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  })

  test('is named after the folder', () => {
    expect(pickedFolder([picked('Vault/Plan.md'), picked('Vault/a/b.md')])).toBe('Vault')
    expect(pickedFolder([])).toBeNull()
  })

  test('holds what was inside it rather than a folder of the same name', () => {
    expect(
      insideFolder([picked('Vault/Plan.md'), picked('Vault/a/b.md')]).map(
        (one) => one.webkitRelativePath,
      ),
    ).toEqual(['Plan.md', 'a/b.md'])
  })
})
