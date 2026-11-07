import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Listing } from './commands'

const DISK: Record<string, string[]> = {
  '/home/me': ['Music', 'Pictures', 'notes.txt', 'plan.pdf'],
  '/home/me/Pictures': ['a.png'],
  '/home/me/Music': [],
  '/home': ['me'],
  '/': ['home'],
}

const opened: string[] = []

vi.mock('./commands', () => ({
  CHANGED: 'explorer://changed',
  listFolder: (path: string): Promise<Listing> => {
    const names = DISK[path]
    if (!names) return Promise.reject(new Error(`${path}: No such file or directory`))
    return Promise.resolve({
      path,
      parent: null,
      own: false,
      spaces: false,
      cut: false,
      entries: names.map((name) => ({
        name,
        kind: name.includes('.') ? 'file' : 'folder',
        folder: !name.includes('.'),
        size: 2048,
        modified: 0,
        hidden: false,
      })),
    })
  },
  watchFolder: () => Promise.resolve(),
  unwatchFolder: () => Promise.resolve(),
  listPlaces: () =>
    Promise.resolve([
      { kind: 'home', path: '/home/me', name: null },
      { kind: 'root', path: '/', name: null },
    ]),
  openWithSystem: (path: string) => {
    opened.push(path)
    return Promise.resolve()
  },
  renameTo: (path: string, name: string) => {
    changed.push(`rename ${path} ${name}`)
    return Promise.resolve(`/home/me/${name}`)
  },
  trashPaths: (paths: string[]) => {
    changed.push(`trash ${paths.join(',')}`)
    return Promise.resolve(paths.map((path) => ({ path, back: path, at: 1 })))
  },
  makeIn: (folder: string, name: string) => {
    changed.push(`make ${folder} ${name}`)
    return Promise.resolve(`${folder}/${name}`)
  },
  showInSystem: () => Promise.resolve(),
  factsOf: (path: string) =>
    Promise.resolve({
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind: 'file',
      folder: false,
      size: 2048,
      modified: 0,
      hidden: false,
      created: null,
      accessed: null,
      readonly: false,
      mode: 'rw-r--r--',
      link: null,
    }),
  peekAt: () => Promise.resolve({ bytes: new TextEncoder().encode('hello'), cut: false }),
  searchBelow: () => Promise.resolve({ found: 0, cut: false, cancelled: false }),
  FOUND: 'explorer://found',
  PROGRESS: 'explorer://progress',
  cancelJob: () => Promise.resolve(),
}))

const changed: string[] = []

const { workspace } = await import('../workspace.svelte')
const ExplorerTab = (await import('./ExplorerTab.svelte')).default
const { viewOf } = await import('./view.svelte')

const settled = async () => {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  flushSync()
}

let target: HTMLElement
let close: (() => void) | undefined

async function explorer() {
  const tab = workspace.openUnsaved('explorer', '', 'me')
  const made = mount(ExplorerTab, { target, props: { tab, focused: true } })
  close = () => void unmount(made)
  await settled()
  return { tab, view: viewOf(tab) }
}

function rows(): string[] {
  return [...target.querySelectorAll('.entry .nib-row-label')].map((one) => one.textContent)
}

function press(key: string, more: KeyboardEventInit = {}) {
  const focused = document.activeElement
  const on = focused && target.contains(focused) ? focused : target.querySelector('.rows')
  on?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more }))
  flushSync()
}

beforeEach(() => {
  opened.length = 0
  changed.length = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

describe('a file explorer', () => {
  test('lists the home folder, folders first, with the places beside it', async () => {
    await explorer()
    expect(rows()).toEqual(['Music', 'Pictures', 'notes.txt', 'plan.pdf'])
    const places = [...target.querySelectorAll('.place .nib-row-label')].map(
      (one) => one.textContent,
    )
    expect(places).toEqual(['Home', 'Computer'])
    expect(target.querySelector('.place.is-on')?.textContent).toContain('Home')
    expect(target.querySelector('.foot')?.textContent).toContain('4 items')
  })

  test('walks with the arrows, opens a folder with Enter and goes up with Backspace', async () => {
    const { view } = await explorer()
    press('ArrowDown')
    press('ArrowDown')
    expect(view.picked.cursor).toBe('Pictures')
    press('Enter')
    await settled()
    expect(view.folder).toBe('/home/me/Pictures')
    expect(rows()).toEqual(['a.png'])
    press('Backspace')
    await settled()
    expect(view.folder).toBe('/home/me')
    expect(view.picked.cursor).toBe('Pictures')
  })

  test('jumps to a name as it is typed and picks a range with Shift', async () => {
    const { view } = await explorer()
    press('n')
    expect(view.picked.cursor).toBe('notes.txt')
    press('ArrowDown', { shiftKey: true })
    expect([...view.picked.names]).toEqual(['notes.txt', 'plan.pdf'])
    expect(target.querySelectorAll('.entry.is-picked')).toHaveLength(2)
    expect(target.querySelector('.foot')?.textContent).toContain('2 selected')
  })

  test('opens a file outside the spaces in the app the system opens it with', async () => {
    await explorer()
    const row = [...target.querySelectorAll<HTMLElement>('.entry')].find((one) =>
      one.textContent.includes('plan.pdf'),
    )
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settled()
    expect(opened).toEqual(['/home/me/plan.pdf'])
  })

  test('goes where a path typed into the bar says', async () => {
    const { view } = await explorer()
    target.querySelector<HTMLElement>('.past')?.click()
    await settled()
    const field = target.querySelector<HTMLInputElement>('input.path')
    expect(field?.value).toBe('/home/me')
    if (!field) return
    field.value = '~/Music'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settled()
    expect(view.folder).toBe('/home/me/Music')
    expect(target.querySelector('.said')?.textContent).toContain('empty')
  })

  test('renames in place with F2, the ending left out of what is chosen', async () => {
    await explorer()
    press('n')
    press('F2')
    await settled()
    const field = target.querySelector<HTMLInputElement>('input.rename')
    expect(field?.value).toBe('notes.txt')
    expect([field?.selectionStart, field?.selectionEnd]).toEqual([0, 5])
    if (!field) return
    field.value = 'letters.txt'
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settled()
    expect(changed).toEqual(['rename /home/me/notes.txt letters.txt'])
  })

  test('keeps a name being typed when the folder is read again under it', async () => {
    const { view } = await explorer()
    press('n')
    press('F2')
    await settled()
    const field = target.querySelector<HTMLInputElement>('input.rename')
    if (!field) throw new Error('no rename field')
    field.value = 'let'
    await view.reload()
    await settled()
    expect(target.querySelector('input.rename')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(changed).toEqual([])
  })

  test('puts what is picked in the trash with Delete, and makes a folder with its key', async () => {
    const { workspace: ws } = await import('../workspace.svelte')
    await explorer()
    press('p')
    press('l')
    press('Delete')
    await settled()
    expect(changed).toEqual(['trash /home/me/plan.pdf'])
    expect(ws.undone.last).toEqual({
      kind: 'outside',
      steps: [
        {
          op: 'trashed',
          tickets: [{ path: '/home/me/plan.pdf', back: '/home/me/plan.pdf', at: 1 }],
        },
      ],
    })
    press('N', { ctrlKey: true, shiftKey: true })
    await settled()
    expect(changed.at(-1)).toBe('make /home/me New folder')
  })

  test('narrows the folder as a filter is typed, and Escape brings the rest back', async () => {
    const { view } = await explorer()
    press('f', { ctrlKey: true })
    await settled()
    const field = target.querySelector<HTMLInputElement>('input.filter')
    expect(field).not.toBeNull()
    if (!field) return
    field.value = 'pl'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(rows()).toEqual(['plan.pdf'])
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()
    expect(view.filter).toBe('')
    expect(rows()).toHaveLength(4)
  })

  test('looks at a file with Space, its words and its facts, and puts it away again', async () => {
    await explorer()
    press('n')
    press(' ')
    await settled()
    const look = target.querySelector('.look')
    expect(look?.textContent).toContain('notes.txt')
    expect(look?.textContent).toContain('hello')
    expect(look?.textContent).toContain('rw-r--r--')
    look?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()
    expect(target.querySelector('.look')).toBeNull()
  })

  test('draws the folder as a grid of tiles with Ctrl+2, and as a list with Ctrl+1', async () => {
    const { explorerPrefs } = await import('./prefs.svelte')
    await explorer()
    press('2', { ctrlKey: true })
    await settled()
    expect(target.querySelectorAll('.entry.tile').length).toBe(4)
    press('1', { ctrlKey: true })
    await settled()
    expect(target.querySelectorAll('.entry.tile').length).toBe(0)
    expect(explorerPrefs.view).toBe('list')
  })

  test('renames several at once with F2, one name each from what is found and replaced', async () => {
    await explorer()
    press('n')
    press('ArrowDown', { shiftKey: true })
    press('F2')
    await settled()
    const sheet = target.querySelector('.many')
    expect(sheet?.textContent).toContain('plan.pdf')
    const [find, replace] = [...target.querySelectorAll<HTMLInputElement>('.many input.nib-field')]
    if (!find || !replace) return
    find.value = 'n'
    find.dispatchEvent(new Event('input', { bubbles: true }))
    replace.value = 'N'
    replace.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.querySelector('.many')?.textContent).toContain('Notes.txt')
    expect(target.querySelector('.many')?.textContent).toContain('plaN.pdf')
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settled()
    expect(changed).toEqual([
      'rename /home/me/notes.txt Notes.txt',
      'rename /home/me/plan.pdf plaN.pdf',
    ])
  })

  test('draws only the rows of a long folder in columns that can be seen', async () => {
    const { explorerPrefs } = await import('./prefs.svelte')
    const kept = DISK['/home/me/Pictures'] ?? []
    DISK['/home/me/Pictures'] = Array.from({ length: 5000 }, (_, at) => `p${at}.png`)
    try {
      await explorer()
      press('3', { ctrlKey: true })
      await settled()
      press('ArrowDown')
      press('ArrowDown')
      await settled()
      const drawn = target.querySelectorAll('.column li')
      expect(drawn.length).toBeGreaterThan(0)
      expect(drawn.length).toBeLessThan(100)
    } finally {
      DISK['/home/me/Pictures'] = kept
      explorerPrefs.show('list')
    }
  })

  test('walks into a folder and back out with the sideways arrows in columns', async () => {
    const { explorerPrefs } = await import('./prefs.svelte')
    const { view } = await explorer()
    press('3', { ctrlKey: true })
    await settled()
    expect(explorerPrefs.view).toBe('columns')
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowRight')
    await settled()
    expect(view.folder).toBe('/home/me/Pictures')
    press('ArrowLeft')
    await settled()
    expect(view.folder).toBe('/home/me')
    explorerPrefs.show('list')
  })
})
