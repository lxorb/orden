import { isTodoList } from '@orden/bases/todo-lists'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const asked = vi.hoisted(() => [] as { command: string; args?: unknown }[])
const homes = vi.hoisted(() => ({
  said: [] as { from: string; to: string }[] | null,
  waiting: false,
  dumped: null as string | null,
}))
const relaunched = vi.hoisted(() => ({ count: 0 }))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => {
    relaunched.count++
    return Promise.resolve()
  },
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: unknown) => {
    asked.push({ command, args })
    if (command === 'keep_after_move') {
      homes.dumped = (args as { text: string }).text
      return Promise.resolve()
    }
    if (command === 'drop_after_move') {
      homes.dumped = null
      return Promise.resolve()
    }
    return Promise.resolve(0)
  },
}))

const { finishFormerHome, formerSaid, HOME_CARRIED } = await import('./former-home')

const SCRIPT = readFileSync(join(import.meta.dirname, '../../../src-tauri/src/former.js'), 'utf8')

interface Said {
  homes: { from: string; to: string }[]
  waiting: boolean
  dumped: boolean
  after: string | null
  carried?: boolean
}

function said(): Said | null {
  if (homes.said === null) return null
  return {
    homes: homes.said,
    waiting: homes.waiting,
    dumped: homes.dumped !== null,
    after: homes.waiting ? null : homes.dumped,
  }
}

function pageStarts(former: Said | null): void {
  const page: Record<string, unknown> = { localStorage }
  page.top = page
  const script = SCRIPT.replace('/* __FORMER__ */ null', JSON.stringify(former))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script the window is given, run as the window runs it
  const run = new Function('window', script) as (window: unknown) => void
  run(page)
  vi.stubGlobal('__ORDEN_FORMER__', page.__ORDEN_FORMER__)
}

async function start(): Promise<boolean> {
  pageStarts(said())
  return finishFormerHome()
}
const { ItemMetaStore } = await import('./item-meta.svelte')
const { pickedInbox } = await import('../rows/inbox')
const { projectsOf } = await import('../rows/projects')
const { ROOTS_MOVED } = await import('./roots-moved')

interface Profile {
  base: { from: string; to: string }
  join: (...parts: string[]) => string
}

const mac: Profile = {
  base: {
    from: '/Users/ada/Library/Application Support/former.app.id',
    to: '/Users/ada/Library/Application Support/so.orden.Orden',
  },
  join: (...parts) => parts.join('/'),
}

const windows: Profile = {
  base: {
    from: 'C:\\Users\\ada\\AppData\\Local\\former.app.id',
    to: 'C:\\Users\\ada\\AppData\\Local\\so.orden.Orden',
  },
  join: (...parts) => parts.join('\\'),
}

function oldProfile({ base, join }: Profile) {
  const root = join(base.from, 'Spaces', 'Work')
  localStorage.setItem(
    'orden:item-meta',
    JSON.stringify({
      [root]: {
        items: {
          'Projects/Plan.md': { 'todo-list': 'yes', 'done-on': 'k3:20261101' },
          'Lists/Groceries.md': { 'todo-list': 'yes' },
          Projects: { 'todo-lists': 'marked' },
        },
        unsent: {},
        adopted: true,
        moved: true,
        lists: true,
      },
    }),
  )
  localStorage.setItem('orden:inbox', JSON.stringify({ [root]: 'Lists/Groceries.md' }))
  localStorage.setItem('orden:projects', JSON.stringify({ [root]: 'Areas' }))
  localStorage.setItem(
    'orden:workspace',
    JSON.stringify({ spaces: [{ root, name: 'Work' }], active: root }),
  )
  localStorage.setItem('orden:theme', 'dark')
}

function startedAfterTheMove({ base, join }: Profile) {
  const root = join(base.to, 'Spaces', 'Work')
  const kept = JSON.parse(localStorage.getItem('orden:item-meta') ?? '{}') as object
  localStorage.setItem(
    'orden:item-meta',
    JSON.stringify({
      ...kept,
      [root]: {
        items: { 'Inbox today.md': { 'todo-list': 'yes' } },
        unsent: {},
        adopted: false,
        moved: false,
        lists: true,
      },
    }),
  )
  localStorage.setItem(
    'orden:workspace',
    JSON.stringify({ spaces: [{ root, name: 'Work' }], active: root }),
  )
}

beforeEach(() => {
  localStorage.clear()
  asked.length = 0
  homes.said = []
  homes.waiting = false
  homes.dumped = null
  relaunched.count = 0
})

describe.each([
  ['a Mac', mac],
  ['Windows', windows],
])('an older profile on %s brought to this build', (_, profile) => {
  const now = profile.join(profile.base.to, 'Spaces', 'Work')

  test('keeps every todo list, the chosen inbox and the Projects folder', async () => {
    oldProfile(profile)
    homes.said = [profile.base]

    expect(await start()).toBe(false)

    const meta = new ItemMetaStore(() => now)
    for (const path of ['Projects/Plan.md', 'Lists/Groceries.md']) {
      expect(isTodoList(path, meta.itemsOf(now)[path])).toBe(true)
    }
    expect(meta.valueOf(profile.join(now, 'Projects', 'Plan.md'), 'done-on', now)).toBe(
      'k3:20261101',
    )
    expect(meta.listsMarked(now)).toBe(true)
    expect(pickedInbox(now, [])).toBe('Lists/Groceries.md')
    expect(projectsOf(now)).toBe('Areas')
    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(localStorage.getItem('orden:item-meta')).not.toContain('former.app.id')
    expect(asked).toContainEqual({ command: 'rehome_snapshots', args: profile.base })
    expect(JSON.parse(localStorage.getItem(ROOTS_MOVED) ?? '[]')).toEqual([profile.base])
  })

  test('joins what a start after the move already kept, and loses neither', async () => {
    oldProfile(profile)
    startedAfterTheMove(profile)
    homes.said = [profile.base]

    expect(await start()).toBe(false)

    const meta = new ItemMetaStore(() => now)
    for (const path of ['Projects/Plan.md', 'Lists/Groceries.md', 'Inbox today.md']) {
      expect(isTodoList(path, meta.itemsOf(now)[path])).toBe(true)
    }
    const session = JSON.parse(localStorage.getItem('orden:workspace') ?? '{}') as {
      spaces: unknown[]
      active: string
    }
    expect(session.spaces).toEqual([{ root: now, name: 'Work' }])
    expect(session.active).toBe(now)
  })
})

describe('a browser profile an early start made beside the old one', () => {
  test('is kept by the app, which starts again so the old one comes back joined with it', async () => {
    const now = mac.join(mac.base.to, 'Spaces', 'Work')
    startedAfterTheMove(mac)
    localStorage.setItem('orden:font', 'Lato')
    homes.said = [mac.base]
    homes.waiting = true

    expect(await start()).toBe(true)
    expect(relaunched.count).toBe(1)
    expect(homes.dumped).not.toBeNull()

    localStorage.clear()
    oldProfile(mac)
    localStorage.setItem('orden:font', 'Inter')
    homes.waiting = false

    expect(await start()).toBe(false)
    expect(homes.dumped).toBeNull()
    const meta = new ItemMetaStore(() => now)
    for (const path of ['Projects/Plan.md', 'Lists/Groceries.md', 'Inbox today.md']) {
      expect(isTodoList(path, meta.itemsOf(now)[path])).toBe(true)
    }
    expect(pickedInbox(now, [])).toBe('Lists/Groceries.md')
    expect(localStorage.getItem('orden:font')).toBe('Lato')
  })

  test('that cannot step aside yet is kept again, and the app does not start again', async () => {
    homes.said = [mac.base]
    homes.waiting = true
    homes.dumped = '{}'
    localStorage.setItem('orden:font', 'Lato')

    expect(await start()).toBe(false)
    expect(relaunched.count).toBe(0)
    expect(JSON.parse(homes.dumped)).toEqual({ 'orden:font': 'Lato' })
  })
})

describe('carrying the former home', () => {
  test('happens once, and a profile with nothing under the old name reloads nothing', async () => {
    homes.said = [mac.base]
    localStorage.setItem('orden:theme', 'dark')

    expect(await start()).toBe(false)
    expect(localStorage.getItem(HOME_CARRIED)).toBe('1')
    asked.length = 0
    expect(await start()).toBe(false)
    expect(asked).toEqual([])
  })

  test('is done by the script the window is given, before any of the app runs', () => {
    const now = mac.join(mac.base.to, 'Spaces', 'Work')
    oldProfile(mac)
    homes.said = [mac.base]
    pageStarts(said())

    expect(formerSaid()?.carried).toBe(true)
    expect(pickedInbox(now, [])).toBe('Lists/Groceries.md')
    vi.stubGlobal('__ORDEN_FORMER__', undefined)
    expect(formerSaid()).toBeNull()
  })

  test('is not marked done by a build that has no former home, so the update still carries it', async () => {
    homes.said = []
    oldProfile(mac)

    expect(await start()).toBe(false)
    expect(localStorage.getItem(HOME_CARRIED)).toBeNull()
    homes.said = [mac.base]
    await start()
    expect(pickedInbox(mac.join(mac.base.to, 'Spaces', 'Work'), [])).toBe('Lists/Groceries.md')
  })

  test('waits for a later start when the app cannot say where the old home was', async () => {
    homes.said = null
    expect(await start()).toBe(false)
    expect(localStorage.getItem(HOME_CARRIED)).toBeNull()
  })
})
