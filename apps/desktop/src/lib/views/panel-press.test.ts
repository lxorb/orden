import { describe, expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as unknown[][])
vi.mock('./open', () => ({
  openTodos: (...args: unknown[]) => opened.push(['todos', ...args]),
  openProject: (...args: unknown[]) => opened.push(['project', ...args]),
  openLabel: (...args: unknown[]) => opened.push(['label', ...args]),
  openBaseFile: (...args: unknown[]) => opened.push(['base', ...args]),
}))

const { choose, chosenIn, openInTab, sameRow, specOf } = await import('./panel-press')

describe('a press on a row of the Tasks panel', () => {
  test('chooses the row, and only Ctrl, Cmd or the middle button asks for a tab', () => {
    expect(choose({ button: 0 })).toBe('select')
    expect(choose({})).toBe('select')
    expect(choose({ button: 0, ctrlKey: true })).toBe('tab')
    expect(choose({ button: 0, metaKey: true })).toBe('tab')
    expect(choose({ button: 1 })).toBe('tab')
  })

  test('says which row is chosen, and what each row shows', () => {
    expect(sameRow({ kind: 'label', tag: 'home' }, { kind: 'label', tag: 'home' })).toBe(true)
    expect(sameRow({ kind: 'label', tag: 'home' }, { kind: 'label', tag: 'work' })).toBe(false)
    expect(sameRow(null, { kind: 'todos' })).toBe(false)
    expect(specOf({ kind: 'todos', space: 'Notes' })).toEqual({ builtin: 'todos', space: 'Notes' })
    expect(specOf({ kind: 'project', space: 'Notes', path: 'Home.md' })).toEqual({
      builtin: 'project',
      space: 'Notes',
      path: 'Home.md',
    })
    expect(specOf({ kind: 'label', tag: 'home' })).toEqual({ builtin: 'label', tag: 'home' })
    expect(specOf({ kind: 'base', path: '/s/Bugs.base' })).toBeNull()
  })

  test('a label of the open space shows that space alone, in the panel and in a tab', () => {
    const row = { kind: 'label', tag: 'home', space: 'Notes' } as const
    expect(specOf(row)).toEqual({ builtin: 'label', tag: 'home', space: 'Notes' })
    opened.length = 0
    openInTab(row)
    expect(opened).toEqual([['label', 'home', { preview: false }, 'Notes']])
  })

  test('what was chosen in one space goes back to Todos in another', () => {
    const row = { kind: 'project', space: 'Notes', path: 'Home.md' } as const
    const here = { id: 'n', name: 'Notes', root: '/s/Notes' }
    expect(chosenIn({ row, in: here }, here)).toBe(row)
    expect(chosenIn({ row, in: here }, { id: 'w', name: 'Work', root: '/s/Work' })).toEqual({
      kind: 'todos',
    })
  })

  test('and one of a space renamed stays chosen, under its new name', () => {
    const was = { id: 'n', name: 'Notes', root: '/s/Notes' }
    const now = { id: 'n', name: 'Field', root: '/s/Field' }
    expect(chosenIn({ row: { kind: 'label', tag: 'a', space: 'Notes' }, in: was }, now)).toEqual({
      kind: 'label',
      tag: 'a',
      space: 'Field',
    })
    expect(
      chosenIn({ row: { kind: 'project', space: 'Notes', path: 'H.md' }, in: was }, now),
    ).toEqual({ kind: 'project', space: 'Field', path: 'H.md' })
    expect(chosenIn({ row: { kind: 'base', path: '/s/Notes/B.base' }, in: was }, now)).toEqual({
      kind: 'todos',
    })
  })

  test('asked for a tab, opens one that is kept, never a preview a press replaces', () => {
    opened.length = 0
    openInTab({ kind: 'todos', space: 'Notes' })
    openInTab({ kind: 'project', space: 'Notes', path: 'Home.md' })
    openInTab({ kind: 'label', tag: 'home' })
    openInTab({ kind: 'base', path: '/s/Bugs.base' })
    expect(opened).toEqual([
      ['todos', 'Notes', { preview: false }],
      ['project', 'Notes', 'Home.md', undefined, { preview: false }],
      ['label', 'home', { preview: false }],
      ['base', '/s/Bugs.base', { preview: false }],
    ])
  })
})
