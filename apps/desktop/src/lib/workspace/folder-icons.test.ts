import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FolderIcons, folderIconMap, MOST_FOLDER_ICONS } from './folder-icons.svelte'

/** The map a space keeps of what its folders wear.
 *
 *  A folder has no file, so this is the one icon in the app that is kept beside the
 *  thing it belongs to rather than inside it - which buys one obligation: a folder
 *  that is renamed, moved or deleted has to say so, or the map quietly points at
 *  paths that are not there any more. That is most of what is tested here.
 *
 *  Nothing is pushed anywhere under node: the push imports the account and the
 *  syncing loop, both of which answer with nothing signed out. */

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
  localStorage.clear()
  icons = new FolderIcons(() => ROOT)
})

describe('the icon a folder wears', () => {
  test('is kept under the folder s path as the space speaks it', () => {
    icons.set('/space/Work', 'rocket')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket' })
    expect(icons.iconOf('/space/Work')).toBe('rocket')
  })

  /** The surfaces that draw a folder disagree about which path they know: the tree
   *  knows the one on this disk, a bookmark and the Move sheet know the space's. */
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

  /** A path with a drive letter or a `..` in it is one no other machine could
   *  resolve, and the map travels. */
  test('is refused for a path that is not inside the space', () => {
    icons.set('/elsewhere/Work', 'rocket')

    expect(icons.of(ROOT)).toEqual({})
  })
})

/** The obligation the map buys: every path that changes has to be rewritten, or an
 *  icon quietly stops being drawn. */
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
      // `Work` does not hold `Working`, however alike the two names look.
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

  /** The map is kept under the space's root, and renaming a space moves the root. */
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

/** What the account holds and what this machine holds, put together. The rule is
 *  the bookmarks' rule: fold once, then the account is the one copy - or an icon
 *  taken away on another machine would be handed straight back to it. */
describe('what the account says the folders wear', () => {
  test('is taken on, with what this machine had folded in the first time', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, { Notes: 'anchor' }, 'someone')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket', Notes: 'anchor' })
  })

  test('and after that it is the one copy, so a removal elsewhere lands here', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, { Work: 'rocket' }, 'someone')
    icons.adopt(ROOT, {}, 'someone')

    expect(icons.of(ROOT)).toEqual({})
  })

  test('a different account signing in folds again, since its copy is another one', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, {}, 'someone')
    icons.adopt(ROOT, { Notes: 'anchor' }, 'somebody else')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket', Notes: 'anchor' })
  })

  /** The service is deployed on its own, so a build of it older than this app
   *  answers with nothing at all where the map should be. */
  test('is read rather than trusted', () => {
    icons.set('/space/Work', 'rocket')
    icons.adopt(ROOT, undefined, 'someone')

    expect(icons.of(ROOT)).toEqual({ Work: 'rocket' })
  })
})

/** The same reading the service does, so nothing is kept here that would be
 *  refused there and nothing drawn that could not have arrived. */
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
    // The ones already there can still be changed and taken away.
    icons.set('/space/Folder 0', 'anchor')
    expect(icons.iconOf('/space/Folder 0')).toBe('anchor')
  })
})
