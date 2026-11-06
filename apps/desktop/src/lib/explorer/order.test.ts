import { describe, expect, it } from 'vitest'
import type { Entry } from './commands'
import { endingOf, ordered } from './order'

function entry(name: string, more: Partial<Entry> = {}): Entry {
  return { name, kind: 'file', folder: false, size: 0, modified: 0, hidden: false, ...more }
}

describe('a folder in a file explorer', () => {
  const entries = [
    entry('b 10.txt', { size: 5, modified: 3 }),
    entry('b 2.txt', { size: 50, modified: 1 }),
    entry('Zeta', { kind: 'folder', folder: true, modified: 9 }),
    entry('.hidden', { hidden: true }),
    entry('alpha.pdf', { size: 7, modified: 2 }),
  ]
  const names = (list: Entry[]) => list.map((one) => one.name)

  it('lists folders first and names as a person counts', () => {
    expect(names(ordered(entries, { key: 'name', down: false }, false))).toEqual([
      'Zeta',
      'alpha.pdf',
      'b 2.txt',
      'b 10.txt',
    ])
  })

  it('turns round with the column and keeps folders first', () => {
    expect(names(ordered(entries, { key: 'size', down: true }, false))).toEqual([
      'Zeta',
      'b 2.txt',
      'alpha.pdf',
      'b 10.txt',
    ])
    expect(names(ordered(entries, { key: 'modified', down: false }, false))[1]).toBe('b 2.txt')
    expect(names(ordered(entries, { key: 'kind', down: false }, false))[1]).toBe('alpha.pdf')
  })

  it('shows hidden files only when asked', () => {
    expect(names(ordered(entries, { key: 'name', down: false }, true))).toContain('.hidden')
  })

  it("reads a kind off a name's ending", () => {
    expect(endingOf('Plan.MD')).toBe('md')
    expect(endingOf('.bashrc')).toBe('')
    expect(endingOf('Makefile')).toBe('')
  })
})
