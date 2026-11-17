import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DeviceView } from './device.svelte'

function memory(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at: number) => [...held.keys()][at] ?? null,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value)
    },
    removeItem: (key: string) => {
      held.delete(key)
    },
    clear: () => held.clear(),
  }
}

let store: Storage

beforeEach(() => {
  store = memory()
  vi.stubGlobal('localStorage', store)
})

describe('the icon a space wears', () => {
  test('is remembered, by folder rather than by id', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'GraduationCap')

    expect(view.iconOf('/Notes')).toBe('GraduationCap')
    expect(new DeviceView().iconOf('/Notes')).toBe('GraduationCap')
  })

  test('and a space that chose none says so, which is what draws its letter', () => {
    expect(new DeviceView().iconOf('/Notes')).toBeNull()
  })

  test('follows the folder when it is renamed', () => {
    const view = new DeviceView()
    view.setIcon('/Uni', 'GraduationCap')
    view.follow({ op: 'moved', from: '/Uni', to: '/University', kind: 'space', root: '/Uni' })

    expect(view.iconOf('/Uni')).toBeNull()
    expect(view.iconOf('/University')).toBe('GraduationCap')
  })

  test('is taken away by choosing none', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')
    view.setIcon('/Notes', null)

    expect(view.iconOf('/Notes')).toBeNull()
    expect(new DeviceView().iconOf('/Notes')).toBeNull()
  })
})

describe('the colour a space is drawn in', () => {
  test('comes down with the icon, and the account is the one copy', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', 'Book', 'teal')).toBeNull()
    expect(view.tintOf('/Notes')).toBe('teal')
    expect(new DeviceView().tintOf('/Notes')).toBe('teal')
  })

  test('so a colour taken off on another machine is taken off here', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', 'Book', null)).toBeNull()
    expect(view.tintOf('/Notes')).toBeNull()
    expect(view.iconOf('/Notes')).toBe('Book')
  })

  test('stays when the account has no column for it, and asks to be sent up', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', 'Book')).toBe('violet')
    expect(view.tintOf('/Notes')).toBe('violet')
  })

  test('and a space with no colour here has nothing to send', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')

    expect(view.applyIcon('/Notes', 'Book')).toBeNull()
  })

  test('goes with the icon it was drawing', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', null, null)).toBeNull()
    expect(view.iconOf('/Notes')).toBeNull()
    expect(view.tintOf('/Notes')).toBeNull()
  })

  test('follows the folder when it is renamed, the way the icon does', () => {
    const view = new DeviceView()
    view.setIcon('/Uni', 'GraduationCap', 'teal')
    view.follow({ op: 'moved', from: '/Uni', to: '/University', kind: 'space', root: '/Uni' })

    expect(view.tintOf('/Uni')).toBeNull()
    expect(view.tintOf('/University')).toBe('teal')
  })
})

describe('storage that arrives after the store was built', () => {
  test('is read on the second asking, which is the plugin', () => {
    const view = new DeviceView()
    expect(view.iconOf('/Uni')).toBeNull()
    expect(view.recent).toEqual([])

    store.setItem('orden:icons', JSON.stringify({ '/Uni': 'GraduationCap' }))
    store.setItem('orden:recent', JSON.stringify(['/Uni/Lecture.md']))
    store.setItem('orden:expanded', JSON.stringify({ '/Uni': true }))
    view.reread()

    expect(view.iconOf('/Uni')).toBe('GraduationCap')
    expect(view.recent).toEqual(['/Uni/Lecture.md'])
    expect(view.isExpanded('/Uni')).toBe(true)
  })

  test('and does not undo what was chosen while it was on its way', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')
    view.reread()

    expect(view.iconOf('/Notes')).toBe('Book')
  })

  test('reads nonsense as nothing written', () => {
    store.setItem('orden:icons', '{oh no')
    const view = new DeviceView()

    expect(view.icons).toEqual({})
  })
})

describe('folding the whole list', () => {
  test('shuts every row of the one space and leaves the others as they were', () => {
    const view = new DeviceView()
    view.expand('/Notes/A')
    view.expand('/Notes/A/B')
    view.expand('/Other/C')

    view.foldUnder('/Notes')

    expect(view.expanded).toEqual({ '/Other/C': true })
    expect(JSON.parse(store.getItem('orden:expanded') ?? '{}')).toEqual({ '/Other/C': true })
  })

  test('does not take a space whose name only starts the same way', () => {
    const view = new DeviceView()
    view.expand('/Notebook/A')

    view.foldUnder('/Note')

    expect(view.isExpanded('/Notebook/A')).toBe(true)
  })
})

describe('the folders remembered open', () => {
  test('forget a folder that was deleted, and everything open under it', () => {
    const view = new DeviceView()
    view.expanded = { '/s/a': true, '/s/a/b': true, '/s/ab': true }
    view.follow({ op: 'removed', path: '/s/a', kind: 'folder', root: '/s' })

    expect(view.expanded).toEqual({ '/s/ab': true })
    expect(new DeviceView().expanded).toEqual({ '/s/ab': true })
  })

  test('and every one of a space that went', () => {
    const view = new DeviceView()
    view.expanded = { '/s/a': true, '/t/a': true }
    view.follow({ op: 'removed', path: '/s', kind: 'space', root: '/s' })

    expect(view.expanded).toEqual({ '/t/a': true })
  })

  test('follow a folder that was moved or renamed', () => {
    const view = new DeviceView()
    view.expanded = { '/s/a': true, '/s/a/b': true }
    view.follow({ op: 'moved', from: '/s/a', to: '/s/c', kind: 'folder', root: '/s' })

    expect(view.expanded).toEqual({ '/s/c': true, '/s/c/b': true })
  })

  test('are checked against a listing of one space, and the others left alone', () => {
    const view = new DeviceView()
    view.expanded = { '/s/a': true, '/s/gone': true, '/s/Case': true, '/t/x': true }
    const listed: Record<string, string> = { '/s/a': '/s/a', '/s/Case': '/s/case' }
    view.keepOpen('/s', (path) => listed[path] ?? null)

    expect(view.expanded).toEqual({ '/s/a': true, '/s/case': true, '/t/x': true })
    expect(new DeviceView().expanded).toEqual(view.expanded)
  })
})
