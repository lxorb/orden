import { beforeEach, describe, expect, test, vi } from 'vitest'

import { toBase64 } from '../platform/src/bytes'
import { writeShortcut } from '@orden/scan/shortcut'
import type { Planned } from './plan'
import { mozLz4Of, SIDEBAR } from './zen.fixture'
import { ZEN_1_17, ZEN_1_17_PLACES } from './zen-versions.fixture'

const disk = new Map<string, string>()

const written: { root: string; files: Planned[] }[] = []

const spaces: { id: string; name: string; root: string }[] = []
const done: string[] = []
const marks: { kind: string; path: string; text: string }[] = []

let sidebar: unknown = SIDEBAR
let firefoxSession: unknown = null
let places: unknown = null

vi.mock('../platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    const packed = (said: unknown) =>
      Promise.resolve(toBase64(mozLz4Of(new TextEncoder().encode(JSON.stringify(said)))))
    if (command === 'read_zen_file') {
      if (args.file === 'zen-sessions.jsonlz4') return packed(sidebar)
      if (args.file === 'sessionstore.jsonlz4' && firefoxSession) return packed(firefoxSession)
      return Promise.reject(new Error('no such file'))
    }
    if (command === 'read_zen_places') {
      return places ? Promise.resolve(JSON.stringify(places)) : Promise.reject(new Error('locked'))
    }
    if (command === 'read_note') {
      const held = disk.get(String(args.path))
      return held === undefined ? Promise.reject(new Error('not found')) : Promise.resolve(held)
    }
    return Promise.reject(new Error(`no ${command} here`))
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isDesktop: true,
}))

vi.mock('./apply', () => ({
  applyImport: (plan: { files: Planned[] }, target: { root: string }) => {
    written.push({ root: target.root, files: plan.files })
    for (const file of plan.files) {
      if (file.kind === 'note') disk.set(`${target.root}/${file.path}`, file.text)
    }
    return Promise.resolve({
      paths: plan.files.map((file) => `${target.root}/${file.path}`),
      stepped: 0,
    })
  },
}))

const readOnly = new Set<string>()
vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

vi.mock('../busy.svelte', () => ({
  busy: { failed: (said: string) => void done.push(`said ${said}`) },
}))

vi.mock('../workspace.svelte', () => {
  let active: string | null = null
  return {
    workspace: {
      spaces,
      get activeSpaceId() {
        return active
      },
      addSpace: (asked: string) => {
        const name = asked.replace(/[:/]/g, ' ').replace(/\s+/g, ' ').trim()
        const space = { id: name, name, root: `/spaces/${name}` }
        spaces.push(space)
        active = space.id
        return Promise.resolve(space)
      },
      selectSpace: (id: string) => {
        active = id
        return Promise.resolve()
      },
      arranged: {
        set: (folder: string, names: string[]) =>
          void done.push(`order ${folder}: ${names.join(', ')}`),
      },
      setSort: (mode: string) => void done.push(`sort ${String(active)} ${mode}`),
      setIcon: (id: string, icon: string, tint: string | null) =>
        void done.push(`icon ${id} ${icon} ${String(tint)}`),
      folderIcons: { iconOf: () => null },
      setFolderIcon: (path: string, icon: string) => void done.push(`folder icon ${path} ${icon}`),
      bookmarks: {
        has: (mark: { path: string }) => marks.some((one) => one.path === mark.path),
        toggleAll: (added: typeof marks) => void marks.push(...added),
      },
    },
  }
})

const { landZen } = await import('./zen-landing')

const PROFILE = {
  name: 'Default (release)',
  path: '/zen/profile',
  files: ['zen-sessions-backup/clean.jsonlz4', 'zen-sessions.jsonlz4'],
}

beforeEach(() => {
  sidebar = SIDEBAR
  firefoxSession = null
  places = null
  disk.clear()
  written.length = 0
  spaces.length = 0
  done.length = 0
  marks.length = 0
  readOnly.clear()
})

describe('Zen brought into Orden', () => {
  test('makes a space of every Zen space, in its order, with its icon and Essentials', async () => {
    const first = await landZen(PROFILE)

    expect(first.name).toBe('Home')
    expect(spaces.map((one) => one.name)).toEqual(['Home', 'Work', 'Reading'])
    expect(written.map((one) => [one.root, one.files.length])).toEqual([
      ['/spaces/Home', 2],
      ['/spaces/Work', 7],
    ])
    expect(done).toContain('order /spaces/Work: Docs, Board.url, b - Search.url, Later.md')
    expect(done).toContain('order /spaces/Work/Docs: The guide.url, API, Left.url, Right.url')
    expect(done).toContain('sort Work manual')
    expect(done).toContain('icon Home 🏡 null')
    expect(done).toContain('icon Work briefcase blue')
    expect(done).toContain('folder icon /spaces/Work/Docs book')
    expect(done).toContain('said Containers stay in Zen')
    expect(marks).toEqual([{ kind: 'note', path: 'Mail.url', text: '' }])
  })

  test('brings only what is new the second time, into the spaces it made', async () => {
    await landZen(PROFILE)
    disk.set(
      '/spaces/Work/Board.url',
      writeShortcut(
        'https://board.example.com/sprint',
        'Board',
        new Date(),
        'https://board.example.com/',
      ),
    )
    disk.set(
      '/spaces/Work/b - Search.url',
      writeShortcut('https://other.example.com/', 'b', new Date()),
    )
    written.length = 0
    done.length = 0

    await landZen(PROFILE)

    expect(spaces.map((one) => one.name)).toEqual(['Home', 'Work', 'Reading'])
    expect(written.map((one) => [one.root, one.files.map((file) => file.path)])).toEqual([
      ['/spaces/Work', ['b - Search.url']],
    ])
    expect(done.filter((one) => one.startsWith('order') || one.startsWith('icon'))).toEqual([])
    expect(marks).toHaveLength(1)
  })

  test('finds the space it made again where the name it asked for was not a folder name', async () => {
    sidebar = {
      ...SIDEBAR,
      spaces: SIDEBAR.spaces.map((one) =>
        one.name === 'Work' ? { ...one, name: 'Work: Client' } : one,
      ),
    }
    await landZen(PROFILE)
    written.length = 0

    await landZen(PROFILE)

    expect(spaces.map((one) => one.name)).toEqual(['Home', 'Work Client', 'Reading'])
    expect(written).toEqual([])
  })

  test("says so when none of the profile's files can be read", async () => {
    await expect(landZen({ ...PROFILE, files: ['sessionstore.jsonlz4'] })).rejects.toThrow(
      'Zen’s tabs could not be read.',
    )
    expect(spaces).toEqual([])
  })
})

describe('a Zen up to 1.17 brought into Orden', () => {
  test('takes its spaces and its Essentials out of Places, which its session lacks', async () => {
    firefoxSession = ZEN_1_17
    places = ZEN_1_17_PLACES

    const first = await landZen({ ...PROFILE, files: ['sessionstore.jsonlz4', 'places.sqlite'] })

    expect(first.name).toBe('Home')
    expect(spaces.map((one) => one.name)).toEqual(['Home', 'Work'])
    expect(marks.map((one) => one.path)).toEqual(['Mail.url', 'Calendar.url', 'Chat.url'])
  })
})

describe('a space of the same name shared to be read', () => {
  test('is passed over, while the rest still land', async () => {
    spaces.push({ id: 'Work', name: 'Work', root: '/spaces/Work' })
    readOnly.add('/spaces/Work')

    const first = await landZen(PROFILE)

    expect(first.name).toBe('Home')
    expect(written.map((one) => one.root)).toEqual(['/spaces/Home'])
    expect(done.filter((one) => one.includes('/spaces/Work') || one.includes('Work '))).toEqual([])
  })
})
