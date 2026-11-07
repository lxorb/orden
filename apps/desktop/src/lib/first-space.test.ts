import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listed } from './seed-space'

const notes = new Map<string, string>()
let reading: (() => void) | null = null
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
        reading?.()
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      default:
        return undefined
    }
  },
}))

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

  test('leaves a page the app was opened with in front, the note behind it', async () => {
    const starting = firstSpace.start(FRESH)
    const page = workspace.openPage('https://example.com/', 'front')
    await starting

    expect(workspace.active?.id).toBe(page)
    expect(workspace.tabs.map((one) => one.path)).toContain(welcome)
  })

  test('leaves a page opened while the welcome note is read in front', async () => {
    let page: string | null = null
    reading = () => {
      reading = null
      page = workspace.openPage('https://example.com/', 'front')
    }
    await firstSpace.start(FRESH)

    expect(page).not.toBeNull()
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

  test('nor the one that linked to Import', () => {
    const linked = `${WELCOME}\n[Import from Obsidian or Notion](orden://settings/import)\n`

    expect(isUntouchedWelcome(`/spaces/Notes/${WELCOME_NAME}`, linked)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Notes/${WELCOME_NAME}`, `${linked}mine\n`)).toBe(false)
  })

  test('nor the one seeded before the rename, whose link said nib://', () => {
    const linked = `${WELCOME}\n[Import from Obsidian or Notion](nib://settings/import)\n`

    expect(isUntouchedWelcome(`/spaces/Notes/${WELCOME_NAME}`, linked)).toBe(true)
  })

  test('suggests no import', () => {
    expect(WELCOME).not.toMatch(/import/i)
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

const { seedSpaceRoot } = await import('./seeded')
const { untouchedSeedSpace } = await import('./seed-space')
const { madeSpace } = await import('./space-actions')
const { invoke } = await import('./tauri')

describe('the space a fresh start made', () => {
  const read = {
    tree: (root: string) => invoke<Listed>('read_tree', { root }),
    note: (path: string) => invoke<string>('read_note', { path }),
  }
  const roots = () => workspace.spaces.map((one) => one.root)

  test('is the default space, and untouched until the reader writes in it', async () => {
    await firstSpace.start(FRESH)
    const root = `/spaces/${WELCOME_SPACE}`
    expect(seedSpaceRoot()).toBe(root)
    expect(await untouchedSeedSpace(seedSpaceRoot(), roots(), read)).toBe(root)

    notes.set(`${root}/${WELCOME_NAME}`, `${WELCOME}\nmine\n`)
    expect(await untouchedSeedSpace(seedSpaceRoot(), roots(), read)).toBeNull()
  })

  test('and a space the reader makes is never it', async () => {
    await madeSpace(WELCOME_SPACE)
    expect(seedSpaceRoot()).toBeNull()
    expect(await untouchedSeedSpace(seedSpaceRoot(), roots(), read)).toBeNull()
  })
})
