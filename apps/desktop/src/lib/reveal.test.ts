import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const opened: string[] = []
const shown: string[] = []
const state = { explorer: false, shows: true }

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
}))
vi.mock('./settings.svelte', () => ({
  hiddenKinds: { offers: (kind: string) => kind === 'explorer' && state.explorer },
}))
vi.mock('./internal/work', () => ({ diskPathOf: (path: string) => Promise.resolve(path) }))
vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: (path: string) => {
    opened.push(path)
    return Promise.resolve()
  },
}))
vi.mock('./explorer/reveal', () => ({
  showInExplorer: (path: string) => {
    shown.push(path)
    return Promise.resolve(state.shows)
  },
}))

const { reveal, showLabel } = await import('./reveal')

beforeEach(() => {
  opened.length = 0
  shown.length = 0
  state.explorer = false
  state.shows = true
})

function sources(folder: string, ending: RegExp): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path, ending)
    return ending.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const LIB = import.meta.dirname
const CRATE = join(LIB, '../../src-tauri/src')
const THE_ONE = /['"](?:\.\.?\/)+reveal['"]/

describe('the words for showing a file where it sits', () => {
  test('name Finder on a Mac only while the system shows it', () => {
    expect(showLabel('macos', false)).toBe('Show in Finder')
    expect(showLabel('macos', true)).toBe('Show in folder')
  })

  test('stay as they were on Windows and Linux', () => {
    expect(showLabel('windows', false)).toBe('Show in folder')
    expect(showLabel('linux', true)).toBe('Show in folder')
  })
})

describe('showing a file where it sits', () => {
  test('is the system file manager while the Orden explorer is off', async () => {
    await reveal('/home/me/Downloads/a.pdf')
    expect(shown).toEqual([])
    expect(opened).toEqual(['/home/me/Downloads/a.pdf'])
  })

  test('is the Orden explorer, with the file picked, while it is on', async () => {
    state.explorer = true
    await reveal('/home/me/Downloads/a.pdf')
    expect(shown).toEqual(['/home/me/Downloads/a.pdf'])
    expect(opened).toEqual([])
  })

  test('falls back to the system for what the Orden explorer cannot show', async () => {
    state.explorer = true
    state.shows = false
    await reveal('/root/secret/a.pdf')
    expect(opened).toEqual(['/root/secret/a.pdf'])
  })

  test('is the system when asked for the system by name', async () => {
    state.explorer = true
    await reveal('/home/me/a.pdf', { system: true })
    expect(shown).toEqual([])
    expect(opened).toEqual(['/home/me/a.pdf'])
  })

  test('goes through this one function from every place that shows a file', () => {
    const callers = sources(LIB, /\.(ts|svelte)$/)
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        return THE_ONE.test(text) && /\breveal\(/.test(text)
      })
      .map((path) => relative(LIB, path).replaceAll('\\', '/'))
      .sort()
    expect(callers).toEqual([
      'commands.ts',
      'explorer/menu.ts',
      'export/save.ts',
      'row-menu.ts',
      'web-tab/downloads.svelte.ts',
    ])
  })

  test('is asked of the system nowhere else, but for an agent that asks the system by name', () => {
    const own = sources(LIB, /\.(ts|svelte)$/)
      .filter((path) => readFileSync(path, 'utf8').includes('revealItemInDir'))
      .map((path) => relative(LIB, path).replaceAll('\\', '/'))
    expect(own).toEqual(['reveal.ts'])
    const crate = sources(CRATE, /\.rs$/)
      .filter((path) => readFileSync(path, 'utf8').includes('reveal_item_in_dir'))
      .map((path) => relative(CRATE, path).replaceAll('\\', '/'))
    expect(crate).toEqual(['agents/system.rs'])
  })
})
