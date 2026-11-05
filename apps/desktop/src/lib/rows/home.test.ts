import { describe, expect, test, vi } from 'vitest'

vi.mock('../sharing.svelte', () => ({
  canWriteAt: () => true,
  isShared: () => false,
  roleOf: () => 'owner',
}))
vi.mock('../workspace.svelte', () => ({ workspace: { shownSpaces: [] } }))

const { homeOf } = await import('./home.svelte')

const spaces = [{ root: '/Team' }, { root: '/Theirs' }, { root: '/Mine' }, { root: '/Later' }]
const owned = new Set(['/Team', '/Mine', '/Later'])
const sharedOut = new Set(['/Team'])
const readOnly = new Set(['/Theirs'])

const home = (
  list = spaces,
  owns = (root: string) => owned.has(root),
  alone = (root: string) => !sharedOut.has(root),
  writable = (root: string) => !readOnly.has(root),
) => homeOf(list, owns, alone, writable)

describe('the reader’s one inbox (#1153)', () => {
  test('is the first space of their own nobody else is in', () => {
    expect(home()).toBe('/Mine')
  })

  test('else the first of their own', () => {
    expect(
      home(
        spaces,
        (root) => owned.has(root),
        () => false,
      ),
    ).toBe('/Team')
  })

  test('else the first that takes a task, never one shared to be read', () => {
    expect(home(spaces, () => false)).toBe('/Team')
    expect(home([{ root: '/Theirs' }, { root: '/Mine' }], () => false)).toBe('/Mine')
  })

  test('is none where no space takes a task', () => {
    expect(home([{ root: '/Theirs' }])).toBeNull()
    expect(home([])).toBeNull()
  })
})
