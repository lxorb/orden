import { beforeEach, describe, expect, test, vi } from 'vitest'

import { toBase64 } from '../bytes'
import type { BrowserProfile } from './browsers'
import * as chromium from './chromium.fixture'
import { BOOKMARKS, SESSION } from './firefox.fixture'
import * as safariFiles from './safari.fixture'
import type { Planned } from './plan'
import { mozLz4Of } from './zen.fixture'

/** What each of the crate's answers is, by command, and what it was asked. */
const files = new Map<string, unknown>()
let places: unknown = BOOKMARKS
let safari: unknown = null
const asked: string[] = []

/** Every import written, space by space. */
const written: { root: string; files: Planned[] }[] = []
const spaces: { id: string; name: string; root: string }[] = []
const said: string[] = []
const marks: { path: string }[] = []

const packed = (value: unknown) =>
  toBase64(mozLz4Of(new TextEncoder().encode(JSON.stringify(value))))

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push(`${command} ${String(args.file ?? args.profile)}`)
    if (command === 'read_browser_file') {
      const held = files.get(String(args.file))
      return held === undefined ? Promise.reject(new Error('no such file')) : Promise.resolve(held)
    }
    if (command === 'read_firefox_places') {
      return places === null
        ? Promise.reject(new Error('locked'))
        : Promise.resolve(JSON.stringify(places))
    }
    if (command === 'read_safari') {
      return typeof safari === 'string'
        ? Promise.reject(new Error(safari))
        : Promise.resolve(JSON.stringify(safari))
    }
    if (command === 'open_full_disk_access') return Promise.resolve()
    if (command === 'read_note') return Promise.reject(new Error('not found'))
    return Promise.reject(new Error(`no ${command} here`))
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isDesktop: true,
}))

vi.mock('./apply', () => ({
  applyImport: (plan: { files: Planned[] }, target: { root: string }) => {
    written.push({ root: target.root, files: plan.files })
    return Promise.resolve({
      paths: plan.files.map((file) => `${target.root}/${file.path}`),
      stepped: 0,
    })
  },
}))

vi.mock('../busy.svelte', () => ({ busy: { failed: (line: string) => void said.push(line) } }))

vi.mock('../workspace.svelte', () => {
  let active: string | null = null
  return {
    workspace: {
      spaces,
      get activeSpaceId() {
        return active
      },
      addSpace: (name: string) => {
        const space = { id: name, name, root: `/spaces/${name}` }
        spaces.push(space)
        active = space.id
        return Promise.resolve(space)
      },
      selectSpace: (id: string) => {
        active = id
        return Promise.resolve()
      },
      arranged: { set: () => undefined },
      setSort: () => undefined,
      setIcon: () => undefined,
      folderIcons: { iconOf: () => null },
      setFolderIcon: () => undefined,
      bookmarks: {
        has: (mark: { path: string }) => marks.some((one) => one.path === mark.path),
        toggleAll: (added: typeof marks) => void marks.push(...added),
      },
    },
  }
})

const { landBrowser } = await import('./browser-landing')

const FIREFOX: BrowserProfile = {
  browser: 'firefox',
  name: 'default-release',
  path: '/firefox/x1.default-release',
  files: [
    'sessionstore-backups/recovery.jsonlz4',
    'sessionstore.jsonlz4',
    'places.sqlite',
    'bookmarkbackups/bookmarks-2026-10-17.jsonlz4',
  ],
}

beforeEach(() => {
  files.clear()
  places = BOOKMARKS
  safari = null
  asked.length = 0
  written.length = 0
  spaces.length = 0
  said.length = 0
  marks.length = 0
})

describe('a Firefox profile brought into nib', () => {
  test('is a space of its tabs, its pinned tab an Essential, its bookmarks a folder', async () => {
    files.set('sessionstore.jsonlz4', packed(SESSION))

    const space = await landBrowser(FIREFOX, false)

    expect(space.name).toBe('Firefox')
    const paths = written[0]?.files.map((one) => one.path) ?? []
    expect(paths).toContain('Mail.url')
    expect(paths).toContain('Docs/The guide.url')
    expect(paths).toContain('Saved groups/Trip/Hotel.url')
    expect(paths).toContain('Bookmarks/Bookmarks toolbar/Work/Board.url')
    expect(marks).toEqual([{ kind: 'note', path: 'Mail.url', text: '' }])
    // The settings page and the bookmarklet are not on the web.
    expect(said).toEqual(['Containers stay in Firefox 2 pages not on the web stay behind'])
    // The running session's file was tried first, and was not there.
    expect(asked[0]).toBe('read_browser_file sessionstore-backups/recovery.jsonlz4')
  })

  test("takes the day's copy of the bookmarks where the database cannot be read", async () => {
    places = null
    files.set('bookmarkbackups/bookmarks-2026-10-17.jsonlz4', packed(BOOKMARKS))

    await landBrowser(FIREFOX, true)

    expect(spaces.map((one) => one.name)).toEqual(['Firefox · default-release'])
    expect(written[0]?.files.map((one) => one.path)).toContain(
      'Bookmarks/Bookmarks menu/Recipes.url',
    )
  })

  test('says so when nothing of the profile can be read', async () => {
    places = null
    await expect(landBrowser(FIREFOX, false)).rejects.toThrow(
      'Nothing could be read out of Firefox.',
    )
    expect(spaces).toEqual([])
  })
})

const CHROME: BrowserProfile = {
  browser: 'chrome',
  name: 'Person 1',
  path: '/chrome/Default',
  files: ['Bookmarks', 'Sessions/Session_13436813666016900', 'Sessions_Encrypted/Session_2'],
}

const bookmarksFile = () => toBase64(new TextEncoder().encode(JSON.stringify(chromium.BOOKMARKS)))

describe('a Chrome profile brought into nib', () => {
  test('is a space of its tabs and groups, its pinned tab an Essential, its bookmarks a folder', async () => {
    files.set('Bookmarks', bookmarksFile())
    files.set('Sessions/Session_13436813666016900', chromium.SESSION)

    const space = await landBrowser(CHROME, false)

    expect(space.name).toBe('Chrome')
    const paths = written[0]?.files.map((one) => one.path) ?? []
    expect(paths).toContain('mail.example.com.url')
    expect(paths).toContain('Docs/docs.example.com guide.url')
    expect(paths).toContain('Bookmarks/Bookmarks bar/Work/Board.url')
    expect(marks).toEqual([{ kind: 'note', path: 'mail.example.com.url', text: '' }])
    expect(said).toEqual(['1 page not on the web stays behind'])
  })

  test('brings the bookmarks alone where the session is encrypted, and says so', async () => {
    files.set('Bookmarks', bookmarksFile())
    files.set('Sessions_Encrypted/Session_2', toBase64(chromium.LOCKED))

    await landBrowser(CHROME, false)

    const paths = written[0]?.files.map((one) => one.path) ?? []
    expect(paths.every((path) => path.startsWith('Bookmarks/'))).toBe(true)
    expect(said).toEqual([
      'Chrome keeps its open tabs locked, so only its bookmarks came. ' +
        '1 page not on the web stays behind',
    ])
  })
})

const SAFARI: BrowserProfile = {
  browser: 'safari',
  name: 'Safari',
  path: '/Users/me/Library/Safari',
  files: [],
}

describe('Safari brought into nib', () => {
  test('is a space of its tab groups, its pinned tab, its bookmarks and its Reading List', async () => {
    safari = { bookmarks: safariFiles.BOOKMARKS, tabs: safariFiles.TABS, session: null }

    const space = await landBrowser(SAFARI, false)

    expect(space.name).toBe('Safari')
    const paths = written[0]?.files.map((one) => one.path) ?? []
    expect(paths).toContain('Cars/One.url')
    expect(paths).toContain('Bookmarks/Favorites/Work/Wiki.url')
    expect(paths).toContain('Reading List/A long read.url')
    expect(marks).toEqual([{ kind: 'note', path: 'Mail.url', text: '' }])
    expect(said).toEqual(['1 page not on the web stays behind'])
  })

  test('opens Full Disk Access and says why where macOS kept the files back', async () => {
    safari = 'no access'

    await expect(landBrowser(SAFARI, false)).rejects.toThrow(
      'macOS keeps Safari’s tabs and bookmarks behind Full Disk Access. Turn Orden on there, then ask again.',
    )
    expect(asked).toContain('open_full_disk_access undefined')
    expect(spaces).toEqual([])
  })
})
