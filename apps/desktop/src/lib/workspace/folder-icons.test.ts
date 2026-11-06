import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FolderIcons, folderIconMap, MOST_FOLDER_ICONS } from './folder-icons.svelte'

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

const ROOT = '/space'

let icons: FolderIcons

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  icons = new FolderIcons(() => ROOT)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the icon a folder wears', () => {
  test('is kept under the folder s path as the space speaks it', () => {
    icons.set('/space/Work', 'rocket')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket' })
    expect(icons.iconOf('/space/Work')).toBe('rocket')
  })

  test('is found by a path on this disk or by the space s own', () => {
    icons.set('/space/Work/Deep', 'anchor')

    expect(icons.iconOf('/space/Work/Deep')).toBe('anchor')
    expect(icons.iconOf('Work/Deep')).toBe('anchor')
  })

  test('is nothing for a folder that never chose one', () => {
    expect(icons.iconOf('/space/Work')).toBeNull()
  })

  test('and taking it away takes the key with it', () => {
    icons.set('/space/Work', 'rocket')
    icons.set('/space/Work', null)

    expect(icons.of(ROOT)).toEqual({})
  })

  test('is written where it can be read again on the next launch', () => {
    icons.set('/space/Work', 'rocket')

    expect(new FolderIcons(() => ROOT).iconOf('/space/Work')).toBe('rocket')
  })

  test('and an emoji, which is what a vault out of Iconize carries', () => {
    icons.set('/space/Work', '🚀')

    expect(icons.iconOf('/space/Work')).toBe('🚀')
  })

  test('is refused for a path that is not inside the space', () => {
    icons.set('/elsewhere/Work', 'rocket')

    expect(icons.of(ROOT)).toEqual({})
  })
})

describe('a folder that moves', () => {
  test('takes its icon with it', () => {
    icons.set('/space/Work', 'rocket')
    icons.moved('/space/Work', '/space/Archive/Work')

    expect(icons.iconOf('/space/Archive/Work')).toBe('rocket')
    expect(icons.iconOf('/space/Work')).toBeNull()
  })

  test('and the icons of everything under it', () => {
    icons.set('/space/Work', 'rocket')
    icons.set('/space/Work/Deep', 'anchor')
    icons.set('/space/Working', 'compass')
    icons.moved('/space/Work', '/space/Archive/Work')

    expect(icons.of(ROOT)).toEqual({
      'Archive/Work': 'rocket',
      'Archive/Work/Deep': 'anchor',
      Working: 'compass',
    })
  })

  test('a rename is the same rewrite, since a rename is a move within a folder', () => {
    icons.set('/space/Work', 'rocket')
    icons.moved('/space/Work', '/space/Studio')

    expect(icons.iconOf('/space/Studio')).toBe('rocket')
  })

  test('and putting the move back puts the icon back', () => {
    icons.set('/space/Work', 'rocket')
    icons.moved('/space/Work', '/space/Archive/Work')
    icons.moved('/space/Archive/Work', '/space/Work')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket' })
  })

  test('a folder that goes takes its icons with it', () => {
    icons.set('/space/Work', 'rocket')
    icons.set('/space/Work/Deep', 'anchor')
    icons.set('/space/Notes', 'compass')
    icons.gone('/space/Work')

    expect(icons.of(ROOT)).toEqual({ Notes: 'compass' })
  })

  test('a space that is renamed keeps every folder icon in it', () => {
    icons.set('/space/Work', 'rocket')
    icons.spaceMoved('/space', '/renamed')

    expect(icons.of('/renamed')).toEqual({ Work: 'rocket' })
    expect(icons.of('/space')).toEqual({})
  })

  test('and a space that goes is forgotten', () => {
    icons.set('/space/Work', 'rocket')
    icons.forget('/space')

    expect(icons.of('/space')).toEqual({})
  })
})

describe('what the account says the folders wear', () => {
  test('is taken on, with what this machine had folded in the first time', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, { Notes: 'anchor' }, {}, 'someone')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket', Notes: 'anchor' })
  })

  test('and after that it is the one copy, so a removal elsewhere lands here', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, { Work: 'rocket' }, {}, 'someone')
    icons.adopt(ROOT, {}, {}, 'someone')

    expect(icons.of(ROOT)).toEqual({})
  })

  test('a different account signing in folds again, since its copy is another one', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, {}, {}, 'someone')
    icons.adopt(ROOT, { Notes: 'anchor' }, {}, 'somebody else')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket', Notes: 'anchor' })
  })

  test('is read rather than trusted', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, undefined, undefined, 'someone')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket' })
  })
})

describe('what the account says those icons are drawn in', () => {
  test('is taken on, with what this machine had folded in the first time', () => {
    icons.set('/space/Work', 'rocket', 'violet')
    icons.adopt(ROOT, { Notes: 'anchor' }, { Notes: 'teal' }, 'someone')

    expect(icons.tintOf('/space/Work')).toBe('violet')
    expect(icons.tintOf('/space/Notes')).toBe('teal')
  })

  test('and after that it is the one copy, so a colour taken away elsewhere lands', () => {
    icons.set('/space/Work', 'rocket', 'violet')
    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'violet' }, 'someone')
    icons.adopt(ROOT, { Work: 'rocket' }, {}, 'someone')

    expect(icons.iconOf('/space/Work')).toBe('rocket')
    expect(icons.tintOf('/space/Work')).toBeNull()
  })

  test('and a colour changed elsewhere lands on the icon that was already here', () => {
    icons.set('/space/Work', 'rocket', 'violet')
    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'violet' }, 'someone')
    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'red' }, 'someone')

    expect(icons.tintOf('/space/Work')).toBe('red')
  })

  test('is read rather than trusted, so an older service takes nothing away', () => {
    icons.set('/space/Work', 'rocket', 'violet')
    icons.adopt(ROOT, { Work: 'rocket' }, undefined, 'someone')

    expect(icons.tintOf('/space/Work')).toBe('violet')
  })

  test('keeps a colour this build has never heard of', () => {
    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'oxblood' }, 'someone')

    expect(icons.tintOf('/space/Work')).toBe('oxblood')
  })
})

describe('a choice the account has not heard', () => {
  test('is kept and folded in rather than replaced by the account s copy', () => {
    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'violet' }, 'someone')

    icons.set('/space/Work', 'rocket', 'teal')
    icons.set('/space/Notes', 'anchor', 'red')

    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'violet' }, 'someone')

    expect(icons.tintOf('/space/Work')).toBe('teal')
    expect(icons.tintOf('/space/Notes')).toBe('red')
    expect(icons.iconOf('/space/Notes')).toBe('anchor')
  })

  test('and once the account has heard it, the account is the one copy again', () => {
    icons.set('/space/Work', 'rocket', 'teal')

    icons.adopt(ROOT, { Work: 'rocket' }, { Work: 'teal' }, 'someone')
    icons.adopt(ROOT, {}, {}, 'someone')

    expect(icons.of(ROOT)).toEqual({})
  })
})

describe('reading a map somebody else wrote', () => {
  test('keeps the pairs and drops everything that is not one', () => {
    expect(
      folderIconMap({
        Work: 'rocket',
        Notes: 7,
        Blank: '   ',
        '/absolute': 'anchor',
        'out/../side': 'anchor',
        'back\\slash': 'anchor',
      }),
    ).toEqual({ Work: 'rocket' })
  })

  test('and nothing at all from something that is not a map', () => {
    expect(folderIconMap(null)).toEqual({})
    expect(folderIconMap('rocket')).toEqual({})
    expect(folderIconMap([['Work', 'rocket']])).toEqual({})
  })

  test('stops at the number a space may keep', () => {
    const many = Object.fromEntries(
      Array.from({ length: MOST_FOLDER_ICONS + 10 }, (_, at) => [`Folder ${at}`, 'rocket']),
    )

    expect(Object.keys(folderIconMap(many))).toHaveLength(MOST_FOLDER_ICONS)
  })

  test('which is also where choosing another one stops', () => {
    for (let at = 0; at < MOST_FOLDER_ICONS; at++) icons.set(`/space/Folder ${at}`, 'rocket')
    icons.set('/space/One too many', 'anchor')

    expect(icons.iconOf('/space/One too many')).toBeNull()
    icons.set('/space/Folder 0', 'anchor')
    expect(icons.iconOf('/space/Folder 0')).toBe('anchor')
  })
})

describe('a map that lands after the store was built', () => {
  test('is read again, and is there', () => {
    expect(icons.iconOf('/space/Work')).toBeNull()

    localStorage.setItem(
      'nib:folder-icons',
      JSON.stringify({ [ROOT]: { icons: { Work: 'briefcase' }, colors: {}, account: null } }),
    )
    icons.reread()

    expect(icons.iconOf('/space/Work')).toBe('briefcase')
  })

  test('and does not undo what was chosen while it was on its way', () => {
    icons.set('/space/Reading', 'book')

    localStorage.setItem(
      'nib:folder-icons',
      JSON.stringify({ [ROOT]: { icons: { Work: 'briefcase' }, colors: {}, account: null } }),
    )
    icons.reread()

    expect(icons.iconOf('/space/Reading')).toBe('book')
  })

  test('and a space this launch knows nothing about comes along whole', () => {
    icons.set('/space/Reading', 'book')

    localStorage.setItem(
      'nib:folder-icons',
      JSON.stringify({
        [ROOT]: { icons: {}, colors: {}, account: null },
        '/other': { icons: { Notes: 'file-text' }, colors: {}, account: null },
      }),
    )
    icons.reread()

    expect(icons.of('/other')).toEqual({ Notes: 'file-text' })
    expect(icons.iconOf('/space/Reading')).toBe('book')
  })
})
