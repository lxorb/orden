import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Entry, Found, Listing } from './commands'

type Heard = (event: { payload: unknown }) => void

const ears = vi.hoisted(() => ({ heard: new Map<string, Heard>() }))

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  isDesktop: true,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, heard: Heard) => {
    ears.heard.set(event, heard)
    return Promise.resolve(() => undefined)
  },
}))

function described(path: string, name: string): Entry {
  const facts = statSync(path)
  const folder = facts.isDirectory()
  const modified = Math.floor(facts.mtimeMs)
  return {
    name,
    kind: folder ? 'folder' : 'file',
    folder,
    size: folder ? 0 : facts.size,
    modified,
    created: facts.birthtimeMs > 0 ? Math.floor(facts.birthtimeMs) : modified,
    hidden: name.startsWith('.'),
  }
}

function below(root: string, folder: string, query: string): Found[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    const here = name.toLowerCase().includes(query)
      ? [{ ...described(path, name), within: folder }]
      : []
    return statSync(path).isDirectory() ? [...here, ...below(root, path, query)] : here
  })
}

vi.mock('./commands', async (original) => ({
  ...(await original<typeof import('./commands')>()),
  listFolder: (path: string): Promise<Listing> =>
    Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: readdirSync(path).map((name) => described(join(path, name), name)),
    }),
  watchFolder: () => Promise.resolve(),
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () => Promise.resolve([]),
  peekAt: () => Promise.resolve({ bytes: new Uint8Array(), cut: false }),
  searchBelow: (job: string, root: string, query: string) => {
    const found = below(root, root, query)
    ears.heard.get('explorer://found')?.({ payload: { job, found } })
    return Promise.resolve({ found: found.length, cut: false, cancelled: false })
  },
  cancelJob: () => Promise.resolve(),
}))

const { workspace } = await import('../workspace.svelte')
const { menu } = await import('../menu.svelte')
const ExplorerTab = (await import('./ExplorerTab.svelte')).default
const { viewOf } = await import('./view.svelte')
const { explorerPrefs } = await import('./prefs.svelte')

const settled = async (ms = 0) => {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve))
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  flushSync()
}

let root: string
const DAY = 86_400_000
const BASE = Date.UTC(2026, 0, 1)

function made(name: string, bytes: number, day: number) {
  const path = join(root, name)
  if (bytes < 0) mkdirSync(path)
  else writeFileSync(path, 'x'.repeat(bytes))
  const at = new Date(BASE + day * DAY)
  utimesSync(path, at, at)
}

let born = true

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'orden-sort-'))
  const steps: [string, number, number][] = [
    ['file 10.txt', 2_000_000, 3],
    ['File 2.md', 900, 1],
    ['photo.PNG', 1_500, 6],
    ['Ärger.pdf', 40, 2],
    ['日記.txt', 50_000, 5],
    ['Folder 10', -1, 4],
    ['folder 9', -1, 7],
  ]
  for (const [name, bytes, day] of steps) {
    made(name, bytes, day)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  writeFileSync(join(root, 'folder 9', 'inner 2.txt'), 'xx')
  writeFileSync(join(root, 'Folder 10', 'inner 1.txt'), 'xxxx')
  utimesSync(join(root, 'Folder 10'), new Date(BASE + 4 * DAY), new Date(BASE + 4 * DAY))
  utimesSync(join(root, 'folder 9'), new Date(BASE + 7 * DAY), new Date(BASE + 7 * DAY))
  born = statSync(join(root, 'file 10.txt')).birthtimeMs > 0
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

let target: HTMLElement
let close: (() => void) | undefined

async function explorer() {
  target = document.createElement('div')
  document.body.append(target)
  const tab = workspace.openUnsaved(
    'explorer',
    JSON.stringify({ folder: root, back: [], ahead: [] }),
    'sort',
  )
  const shown = mount(ExplorerTab, { target, props: { tab, focused: true } })
  close = () => void unmount(shown)
  await settled()
  return viewOf(tab)
}

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  explorerPrefs.show('list')
  explorerPrefs.sortOn('name')
  explorerPrefs.sortTurned(false)
})

function place(one: HTMLElement): [number, number] {
  return [parseFloat(one.style.top) || 0, parseFloat(one.style.insetInlineStart) || 0]
}

function shown(): string[] {
  return [...target.querySelectorAll<HTMLElement>('.entry')]
    .sort((one, other) => {
      const [top, start] = place(one)
      const [otherTop, otherStart] = place(other)
      return top - otherTop || start - otherStart
    })
    .map((one) => one.querySelector('.orden-row-label')?.textContent ?? '')
}

function heads(): string[] {
  return [...target.querySelectorAll('.head .column')].map((one) => one.textContent.trim())
}

function header(at: string) {
  target.querySelector<HTMLElement>(`.head .column.${at}`)?.click()
  flushSync()
}

function chosen(label: string) {
  target.querySelector<HTMLElement>('.bar .sort')?.click()
  const item = menu.items.find((one) => one?.label === label)
  menu.hide()
  item?.run()
  flushSync()
}

const FOLDERS_BY_NAME = ['folder 9', 'Folder 10']
const BY_NAME = ['Ärger.pdf', 'File 2.md', 'file 10.txt', 'photo.PNG', '日記.txt']
const BY_SIZE = ['Ärger.pdf', 'File 2.md', 'photo.PNG', '日記.txt', 'file 10.txt']
const BY_MODIFIED = ['File 2.md', 'Ärger.pdf', 'file 10.txt', '日記.txt', 'photo.PNG']
const FOLDERS_BY_MODIFIED = ['Folder 10', 'folder 9']
const BY_KIND = ['File 2.md', 'Ärger.pdf', 'photo.PNG', 'file 10.txt', '日記.txt']
const BY_KIND_DOWN = ['file 10.txt', '日記.txt', 'photo.PNG', 'Ärger.pdf', 'File 2.md']
const BY_CREATED = ['file 10.txt', 'File 2.md', 'photo.PNG', 'Ärger.pdf', '日記.txt']

const back = (names: string[]) => [...names].reverse()

describe('sorting a real folder in the file explorer', () => {
  test('each column header sorts its own way and turns round when pressed again, folders first', async () => {
    await explorer()
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...BY_NAME])
    expect(heads()[0]).toBe('Name ↑')

    header('name')
    expect(shown()).toEqual([...back(FOLDERS_BY_NAME), ...back(BY_NAME)])
    expect(heads()[0]).toBe('Name ↓')

    header('size')
    expect(heads()[2]).toBe('Size ↓')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...back(BY_SIZE)])
    header('size')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...BY_SIZE])

    header('modified')
    expect(heads()[1]).toBe('Modified ↓')
    expect(shown()).toEqual([...back(FOLDERS_BY_MODIFIED), ...back(BY_MODIFIED)])
    header('modified')
    expect(shown()).toEqual([...FOLDERS_BY_MODIFIED, ...BY_MODIFIED])

    header('kind')
    expect(heads()[3]).toBe('Kind ↑')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...BY_KIND])
    header('kind')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...BY_KIND_DOWN])
  })

  test('the sort menu sorts by when each was made, both ways, in the grid as in the list', async () => {
    await explorer()
    explorerPrefs.show('grid')
    await settled()
    expect(target.querySelector('.head')).toBeNull()
    const order = born ? BY_CREATED : BY_MODIFIED
    const folders = born ? ['Folder 10', 'folder 9'] : FOLDERS_BY_MODIFIED
    chosen('Created')
    expect(shown()).toEqual([...back(folders), ...back(order)])
    chosen('Ascending')
    expect(shown()).toEqual([...folders, ...order])
    chosen('Size')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...back(BY_SIZE)])
    chosen('Name')
    chosen('Descending')
    expect(shown()).toEqual([...back(FOLDERS_BY_NAME), ...back(BY_NAME)])
  })

  test('the columns view sorts the folder above as the list does', async () => {
    const view = await explorer()
    await view.go(join(root, 'folder 9'))
    explorerPrefs.show('columns')
    await settled(300)
    chosen('Modified')
    const above = [...target.querySelectorAll<HTMLElement>('div.column li')]
      .sort((one, other) => place(one)[0] - place(other)[0])
      .map((one) => one.textContent.trim())
    expect(above).toEqual([...back(FOLDERS_BY_MODIFIED), ...back(BY_MODIFIED)])
  })

  test('found files sort by their own name and by their folder, not by the path below the search', async () => {
    const view = await explorer()
    view.searchBelow('e')
    await settled()
    expect(heads()[3]).toBe('Folder')
    const files = ['Ärger.pdf', 'File 2.md', 'file 10.txt']
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...files, 'inner 1.txt', 'inner 2.txt'])
    header('name')
    expect(shown()).toEqual([
      ...back(FOLDERS_BY_NAME),
      'inner 2.txt',
      'inner 1.txt',
      ...back(files),
    ])
    header('kind')
    expect(heads()[3]).toBe('Folder ↑')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...files, 'inner 2.txt', 'inner 1.txt'])
    header('kind')
    expect(heads()[3]).toBe('Folder ↓')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, 'inner 1.txt', 'inner 2.txt', ...files])
  })

  test('the order holds after the watch hears a change and the folder is read again', async () => {
    const view = await explorer()
    header('size')
    expect(shown()).toEqual([...FOLDERS_BY_NAME, ...back(BY_SIZE)])
    made('new 3.txt', 5_000, 8)
    writeFileSync(join(root, 'Ärger.pdf'), 'x'.repeat(3_000_000))
    ears.heard.get('explorer://changed')?.({ payload: { folders: [root] } })
    await settled(300)
    expect(shown()).toEqual([
      ...FOLDERS_BY_NAME,
      'Ärger.pdf',
      'file 10.txt',
      '日記.txt',
      'new 3.txt',
      'photo.PNG',
      'File 2.md',
    ])
    await view.reload()
    await settled()
    expect(heads()[2]).toBe('Size ↓')
    expect(shown()[2]).toBe('Ärger.pdf')
    writeFileSync(join(root, 'Ärger.pdf'), 'x'.repeat(40))
    rmSync(join(root, 'new 3.txt'))
  })
})
