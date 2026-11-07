import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const { formerRoot, hasMoved, rebased, restate, settleRoot, SPACES_ROOT } = await import('./moved')

const OLD =
  '/var/mobile/Containers/Data/Application/03742EE0-9B69-4F07-9D03-0AAB3201676B/Documents/Nib'
const NEW =
  '/var/mobile/Containers/Data/Application/853E8E51-0429-47D9-985E-E17A80F259DF/Documents/Nib'

beforeEach(() => localStorage.clear())

describe('where the spaces folder was', () => {
  test('is what was written down, when it was', () => {
    expect(formerRoot(NEW, [`${OLD}/Notes`])).toBe(NEW)
  })

  test('is otherwise the one folder every space was in', () => {
    expect(formerRoot(null, [`${OLD}/Notes`, `${OLD}/Work`])).toBe(OLD)
  })

  test('is not guessed from spaces in two different folders', () => {
    expect(formerRoot(null, [`${OLD}/Notes`, '/elsewhere/Work'])).toBeNull()
    expect(formerRoot(null, [])).toBeNull()
  })
})

describe('whether it has moved', () => {
  test('when every stored space is there under the new folder', () => {
    const roots = [`${OLD}/Notes`, `${OLD}/Work`]
    expect(hasMoved(OLD, NEW, roots, [`${NEW}/Notes`, `${NEW}/Work`, `${NEW}/Other`])).toBe(true)
  })

  test('not when a space is missing from the new folder', () => {
    const roots = [`${OLD}/Notes`, `${OLD}/Work`]
    expect(hasMoved(OLD, NEW, roots, [`${NEW}/Notes`])).toBe(false)
  })

  test('not when it is where it was, or nothing is stored', () => {
    expect(hasMoved(NEW, NEW, [`${NEW}/Notes`], [`${NEW}/Notes`])).toBe(false)
    expect(hasMoved(OLD, NEW, [], [`${NEW}/Notes`])).toBe(false)
    expect(hasMoved(null, NEW, [`${OLD}/Notes`], [`${NEW}/Notes`])).toBe(false)
  })
})

describe('saying a stored path again under the new folder', () => {
  test('rewrites every path under the old folder, and only those', () => {
    const text = JSON.stringify({
      root: `${OLD}/Notes`,
      tab: `${OLD}/Notes/Read me.md`,
      exact: OLD,
      other: '/somewhere/else/Notes/a.md',
      sibling: `${OLD}er/Notes/a.md`,
    })

    expect(JSON.parse(rebased(text, OLD, NEW))).toEqual({
      root: `${NEW}/Notes`,
      tab: `${NEW}/Notes/Read me.md`,
      exact: NEW,
      other: '/somewhere/else/Notes/a.md',
      sibling: `${OLD}er/Notes/a.md`,
    })
  })

  test('rewrites a Windows path as JSON escapes it', () => {
    const was = 'C:\\Users\\a\\Documents\\Nib'
    const now = 'D:\\Users\\a\\Documents\\Nib'
    const text = JSON.stringify({ tab: `${was}\\Notes\\a.md` })

    expect(JSON.parse(rebased(text, was, now))).toEqual({ tab: `${now}\\Notes\\a.md` })
  })

  test('goes through every key of the app, and none of anybody else', () => {
    localStorage.setItem('orden:workspace', JSON.stringify({ spaces: [{ root: `${OLD}/Notes` }] }))
    localStorage.setItem('orden:recent', JSON.stringify([`${OLD}/Notes/a.md`]))
    localStorage.setItem('orden:theme', 'dark')
    localStorage.setItem('other', JSON.stringify([`${OLD}/Notes/a.md`]))

    expect(restate(OLD, NEW)).toBe(2)
    expect(localStorage.getItem('orden:recent')).toBe(JSON.stringify([`${NEW}/Notes/a.md`]))
    expect(localStorage.getItem('orden:theme')).toBe('dark')
    expect(localStorage.getItem('other')).toBe(JSON.stringify([`${OLD}/Notes/a.md`]))
  })
})

describe('settling where the folder is', () => {
  test('a move rewrites what was stored, notes the new folder and says so', () => {
    localStorage.setItem('orden:mirrors', JSON.stringify({ [`${OLD}/Notes`]: { spaceId: 's1' } }))

    expect(settleRoot(NEW, [`${OLD}/Notes`], [`${NEW}/Notes`])).toBe(OLD)
    expect(JSON.parse(localStorage.getItem('orden:mirrors')!)).toEqual({
      [`${NEW}/Notes`]: { spaceId: 's1' },
    })
    expect(localStorage.getItem(SPACES_ROOT)).toBe(NEW)
  })

  test('no move notes the folder and rewrites nothing', () => {
    localStorage.setItem('orden:recent', JSON.stringify([`${NEW}/Notes/a.md`]))

    expect(settleRoot(NEW, [`${NEW}/Notes`], [`${NEW}/Notes`])).toBeNull()
    expect(localStorage.getItem(SPACES_ROOT)).toBe(NEW)
    expect(localStorage.getItem('orden:recent')).toBe(JSON.stringify([`${NEW}/Notes/a.md`]))
  })

  test('the second launch after a move has nothing left to do', () => {
    settleRoot(NEW, [`${OLD}/Notes`], [`${NEW}/Notes`])
    expect(settleRoot(NEW, [`${NEW}/Notes`], [`${NEW}/Notes`])).toBeNull()
  })
})

describe('restating a record kept under both the old and the new folder', () => {
  test('joins the two, the new one winning where both say something', () => {
    localStorage.setItem(
      'orden:item-meta',
      JSON.stringify({
        [`${OLD}/Notes`]: { items: { 'a.md': { 'todo-list': 'yes' } }, lists: true },
        [`${NEW}/Notes`]: { items: { 'b.md': { 'todo-list': 'yes' } }, lists: false },
      }),
    )

    expect(restate(OLD, NEW)).toBe(1)
    expect(JSON.parse(localStorage.getItem('orden:item-meta')!)).toEqual({
      [`${NEW}/Notes`]: {
        items: { 'a.md': { 'todo-list': 'yes' }, 'b.md': { 'todo-list': 'yes' } },
        lists: false,
      },
    })
  })

  test('says a path twice in a list only once', () => {
    localStorage.setItem(
      'orden:recent',
      JSON.stringify([`${NEW}/Notes/a.md`, `${OLD}/Notes/a.md`, 1, 1]),
    )

    restate(OLD, NEW)
    expect(JSON.parse(localStorage.getItem('orden:recent')!)).toEqual([`${NEW}/Notes/a.md`, 1, 1])
  })
})
