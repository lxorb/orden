import { beforeEach, describe, expect, test, vi } from 'vitest'

import { toBase64 } from '../bytes'
import type { BrowserProfile } from './browsers'
import { BOOKMARKS, SESSION } from './firefox.fixture'
import type { Planned } from './plan'
import { mozLz4Of } from './zen.fixture'

/** What each of the crate's answers is, by command, and what it was asked. */
const files = new Map<string, unknown>()
let places: unknown = BOOKMARKS
const asked: string[] = []

/** Every import written, space by space. */
const written: { root: string; files: Planned[] }[] = []
const spaces: { id: string; name: string; root: string }[] = []
const said: string[] = []
const marks: { path: string }[] = []

const packed = (value: unknown) =>
  toBase64(mozLz4Of(new TextEncoder().encode(JSON.stringify(value))))

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
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
    expect(said).toEqual(['Containers stay in Firefox'])
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
