import { describe, expect, test, vi } from 'vitest'
import type { MenuGroup, MenuRow } from './menu-item'
import type { MenuItem } from './menu-item'
import { de } from '../locales/de'

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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { appMenu } = await import('./app-menu')
const { ISSUES_URL, RELEASES_URL, SOURCE_URL } = await import('./links')
const { isSubmenu, walkableRows } = await import('./menu-item')
const { appCommands } = await import('./commands')
const { BY_ID } = await import('./shortcuts/registry')
const { i18n } = await import('./i18n.svelte')

const menu = (): MenuGroup[] => appMenu({ onpalette: () => undefined, onhistory: () => undefined })

function group(id: string): MenuGroup {
  const found = menu().find((one) => one.id === id)
  if (!found) throw new Error(`no ${id} group in the menu`)
  return found
}

function rows(id: string): MenuRow[] {
  return group(id).rows.filter((row) => row !== null)
}

function actions(id: string): MenuItem[] {
  return rows(id).filter((row): row is MenuItem => row !== null && !isSubmenu(row))
}

const labels = (id: string): string[] => actions(id).map((row) => row.label)

describe('the shape of the menu', () => {
  test('has the six groups a menu bar has, and no seventh for exporting', () => {
    expect(menu().map((one) => one.id)).toEqual([
      'file',
      'edit',
      'paragraph',
      'format',
      'view',
      'help',
    ])
  })

  test('keeps Export under File, as one row with rows of its own', () => {
    const submenus = rows('file').filter(isSubmenu)

    expect(submenus.map((one) => one.label)).toEqual(['Export'])
    expect(submenus[0]?.rows.length).toBeGreaterThan(5)
  })

  test('never goes deeper than one submenu', () => {
    for (const one of menu()) {
      for (const row of one.rows.filter((row) => row !== null && isSubmenu(row))) {
        if (!isSubmenu(row)) continue
        expect(row.rows.filter(isSubmenu), one.id).toEqual([])
      }
    }
  })
})

describe('File', () => {
  test('offers printing', () => {
    const printing = labels('file').includes('Print')
    expect(printing).toBe(typeof window !== 'undefined' && typeof window.print === 'function')
  })

  test('is Export, Print and Version history, and nothing else', () => {
    const read = group('file').rows.map((row) => (row === null ? '---' : row.label))
    const printing = typeof window !== 'undefined' && typeof window.print === 'function'

    expect(read).toEqual(['Export', ...(printing ? ['Print'] : []), '---', 'Version history'])
  })

  test('and every row it gave up is still in the palette and on its key', () => {
    const offered = new Set(appCommands().map((one) => one.id))
    const commands = ['new', 'import', 'space', 'settings']
    for (const id of [
      ...commands,
      'close',
      'reopen',
      'new-window',
      'new-private',
      'close-window',
    ]) {
      expect(offered.has(id), id).toBe(true)
    }

    const keys = [
      'app.new',
      'app.close',
      'app.reopen',
      'app.new-private',
      'app.close-window',
      'app.settings',
    ]
    for (const id of keys) expect(BY_ID.get(id)?.key, id).toBeTruthy()
  })

  test('and every row only the menu had is in the palette now', () => {
    const offered = appCommands().map((one) => one.label)
    for (const label of [
      ...['Undo', 'Redo', 'Inline math', 'Superscript', 'Subscript', 'Paste as plain text'],
      ...['Find next', 'Find previous', 'Fullscreen'],
      ...['What is new', 'Report an issue', 'Source code'],
    ]) {
      expect(offered, label).toContain(label)
    }
  })

  test('and there is no Save anywhere: not in the palette and not on a key', () => {
    const offered = appCommands().map((one) => one.id)
    expect(offered).not.toContain('save')
    expect(offered).not.toContain('save-as')

    expect(BY_ID.has('app.save')).toBe(false)
    expect(BY_ID.has('app.save-as')).toBe(false)
    expect([...BY_ID.values()].filter((one) => one.key === 'Mod-s')).toEqual([])
  })
})

describe('Edit', () => {
  test('offers both pastes and both ways of finding', () => {
    expect(labels('edit')).toEqual([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Paste as plain text',
      'Select all',
      'Find',
      'Replace',
      'Find next',
      'Find previous',
      'Search',
    ])
  })

  test('and the rows that walk from one match to the next, on their keys', () => {
    const edit = menu().find((group) => group.id === 'edit')?.rows ?? []
    const commands = edit.flatMap((row) => (row && 'command' in row ? [row.command] : []))

    expect(commands).toContain('edit.find-next')
    expect(commands).toContain('edit.find-previous')
  })
})

describe('Paragraph and Format', () => {
  test('offer the blocks a note is written out of', () => {
    for (const label of [
      'Task list',
      'Callout',
      'Footnote',
      'Table of contents',
      'Picture',
      'One heading level up',
      'One heading level down',
    ]) {
      expect(labels('paragraph'), label).toContain(label)
    }
  })

  test('offer a comment, which is the one mark that is not for the reader', () => {
    expect(labels('format')).toContain('Comment')
  })
})

describe('View and Help', () => {
  test('leaves Always on top to the desktop', () => {
    expect(labels('view')).not.toContain('Always on top')
  })

  test('sends a bug and a release note to the repository the app is written in', () => {
    expect(labels('help')).toContain('Report an issue')
    expect(labels('help')).toContain('What is new')
    expect(ISSUES_URL.startsWith(SOURCE_URL)).toBe(true)
    expect(RELEASES_URL.startsWith(SOURCE_URL)).toBe(true)
  })
})

describe('the menu, the palette and the shortcut settings agree', () => {
  const shared = [
    ['paragraph.task-list', 'Task list'],
    ['paragraph.callout', 'Callout'],
    ['paragraph.footnote', 'Footnote'],
    ['paragraph.toc', 'Table of contents'],
    ['paragraph.heading-up', 'One heading level up'],
    ['paragraph.heading-down', 'One heading level down'],
    ['format.comment', 'Comment'],
    ['view.fold', 'Fold'],
    ['view.fold-all', 'Fold everything'],
    ['view.unfold-all', 'Unfold everything'],
    ['edit.replace', 'Replace'],
    ['app.print', 'Print'],
  ] as const

  test('every one of them has an entry a key can be put on', () => {
    for (const [id, label] of shared) {
      expect(BY_ID.get(id), id).toBeDefined()
      expect(BY_ID.get(id)?.label(), id).toBe(label)
    }
  })

  test('every block the Paragraph and Format menus offer is in the palette too', () => {
    const offered = new Set(appCommands().map((one) => one.label))
    const elsewhere = new Set(['Replace', 'Print'])

    for (const [, label] of shared) {
      if (elsewhere.has(label)) continue
      expect(offered.has(label), label).toBe(true)
    }
  })

  test('a row that carries a key carries the one the registry holds', () => {
    for (const one of menu()) {
      for (const row of actions(one.id)) {
        if (!row.hint) continue
        expect(row.hint.length, `${one.id}: ${row.label}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('the palette in another language', () => {
  const inGerman = async <T>(read: () => T): Promise<T> => {
    const was = i18n.choice
    i18n.choice = 'de'
    await i18n.load()
    try {
      return read()
    } finally {
      i18n.choice = was
      await i18n.load()
    }
  }

  test('says nothing in English', async () => {
    const english = await inGerman(() =>
      appCommands()
        .map((one) => one.label)
        .filter((label) => /^(Theme|Code theme|Mode|Recent):/.test(label)),
    )

    expect(english).toEqual([])
  })

  test('leaves no row standing in its English wording', async () => {
    const unchanged = await inGerman(() =>
      appCommands()
        .map((one) => one.label)
        .filter((label) => typeof de[label] === 'string' && de[label] !== label),
    )

    expect(unchanged).toEqual([])
  })

  test('ticks the theme in use rather than writing a word beside it', () => {
    const themes = appCommands().filter((one) => one.id.startsWith('theme:'))
    expect(themes.length).toBeGreaterThan(0)

    for (const row of themes) expect(row.hint, row.id).toBeUndefined()
    expect(themes.filter((one) => one.checked).length).toBe(1)
  })

  test('offers the three the scheme can be, one of them ticked', () => {
    const modes = appCommands().filter((one) => one.id.startsWith('scheme:'))

    expect(modes.map((one) => one.id)).toEqual(['scheme:system', 'scheme:dark', 'scheme:light'])
    expect(modes.filter((one) => one.checked).length).toBe(1)
  })
})

describe('where a key may stand in a menu', () => {
  const act = (label: string, disabled = false): MenuItem => ({
    label,
    disabled,
    run: () => undefined,
  })

  test('is every row there is, in the order they are drawn', () => {
    expect(walkableRows([act('one'), act('two'), act('three')])).toEqual([0, 1, 2])
  })

  test('is never a rule between groups', () => {
    expect(walkableRows([act('one'), null, act('two')])).toEqual([0, 2])
  })

  test('is never a row that is greyed out', () => {
    expect(walkableRows([act('one'), act('two', true), act('three')])).toEqual([0, 2])
  })

  test('is a row that leads to more rows, which is where it leads', () => {
    const rows: MenuRow[] = [act('one'), { label: 'Export', rows: [act('as a PDF')] }]
    expect(walkableRows(rows)).toEqual([0, 1])
  })

  test('has nowhere at all in an empty list', () => {
    expect(walkableRows([])).toEqual([])
    expect(walkableRows([null, null])).toEqual([])
  })

  test('is somewhere in the File group, which is live whatever is open', () => {
    expect(walkableRows(group('file').rows).length).toBeGreaterThan(0)
  })

  test('is nowhere in a group where every row is greyed out', () => {
    const paragraph = group('paragraph')
    expect(paragraph.rows.length).toBeGreaterThan(0)
    expect(walkableRows(paragraph.rows)).toEqual([])
  })
})
