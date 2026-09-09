import { describe, expect, test } from 'vitest'
import {
  EMOJI_SET,
  iconValue,
  type IconNode,
  initial,
  isIconTint,
  keyNamed,
  LUCIDE,
  rankIcons,
  readIcon,
  readTint,
  sameIcon,
  search,
  shapeFor,
  words,
  writtenIcon,
} from './icons'

const NAMES = [
  'Book',
  'BookOpen',
  'BookmarkMinus',
  'Bookmark',
  'Briefcase',
  'Building2',
  'Calendar',
  'CalendarDays',
  'Laptop',
  'NotebookPen',
  'Notebook',
  'Star',
  'Sparkles',
  'GraduationCap',
]

describe('turning a name into words', () => {
  test('splits the humps', () => {
    expect(words('BookOpen')).toBe('book open')
    expect(words('CalendarDays')).toBe('calendar days')
  })

  test('keeps a run of capitals together', () => {
    expect(words('RSSFeed')).toBe('rss feed')
  })

  test('leaves a digit attached to its word', () => {
    expect(words('Building2')).toBe('building2')
  })
})

describe('searching the library', () => {
  test('puts the exact name first', () => {
    expect(search(NAMES, 'book')[0]).toBe('Book')
    expect(search(NAMES, 'star')[0]).toBe('Star')
  })

  test('finds the multi-word ones too', () => {
    expect(search(NAMES, 'book')).toContain('BookOpen')
    expect(search(NAMES, 'book open')[0]).toBe('BookOpen')
  })

  test('ranks a whole word above a fragment', () => {
    const found = search(NAMES, 'book')
    expect(found.indexOf('BookOpen')).toBeLessThan(found.indexOf('BookmarkMinus'))
  })

  test('understands words that are not icon names', () => {
    expect(search(NAMES, 'work')).toContain('Briefcase')
    expect(search(NAMES, 'uni')).toContain('GraduationCap')
    expect(search(NAMES, 'journal')).toContain('NotebookPen')
  })

  test('is not case sensitive', () => {
    expect(search(NAMES, 'BOOK')[0]).toBe('Book')
  })

  test('gives back the whole set for an empty query', () => {
    expect(search(NAMES, '  ').length).toBe(NAMES.length)
  })

  test('gives back nothing for a query that matches nothing', () => {
    expect(search(NAMES, 'zzzzz')).toEqual([])
  })

  test('honours the limit', () => {
    expect(search(NAMES, '', 3).length).toBe(3)
  })
})

/** What a space in the switcher actually draws.
 *
 *  Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
 *  plugin right now."* The cause was elsewhere - the storage the chosen name is read
 *  from; see lib/even/first.ts - but the rule the switcher follows is here, and the half
 *  of it that matters is the last test: a space always shows something.
 */
describe('the mark a space wears', () => {
  const CAP: IconNode = [['path', { d: 'M21 10l-9-4-9 4 9 4z' }]]
  const library: Record<string, IconNode> = { GraduationCap: CAP }

  test('is the shape it chose', () => {
    expect(shapeFor(library, 'GraduationCap')).toBe(CAP)
  })

  test('and its initial where it chose none', () => {
    expect(shapeFor(library, null)).toBeNull()
    expect(initial('Uni')).toBe('U')
    expect(initial('  notes')).toBe('N')
    expect(initial('ubung')).toBe('U')
  })

  /** Three different things a reader cannot tell apart: no icon, an icon this build
   *  has never heard of, and a library that has not loaded yet. All three draw a
   *  letter, and none of them draws an empty square. */
  test('is never nothing, whatever went wrong', () => {
    expect(shapeFor(library, 'NoSuchIcon')).toBeNull()
    expect(shapeFor({}, 'GraduationCap')).toBeNull()
    expect(initial('   ')).toBe('·')
  })
})

/** What a note says it wears, and how a written name finds its icon.
 *
 *  The value lives in the note's own front matter, so it is read as well as
 *  written: a vault that comes from Obsidian carries whatever the Iconize plugin
 *  wrote there, and those icons keep working here without anybody choosing them
 *  again. */
describe('the icon a note names', () => {
  const shapes: Record<string, IconNode> = {
    FileText: [['path', { d: 'M4 2h9l5 5v15H4z' }]],
    Gamepad2: [['rect', { x: '2', y: '6', width: '20', height: '12' }]],
    Grid2x2: [['path', { d: 'M3 3h18v18H3z' }]],
    ArrowUp01: [['path', { d: 'M4 20V4' }]],
    Link: [['path', { d: 'M9 15l6-6' }]],
    List: [['path', { d: 'M8 6h13' }]],
    Smile: [['circle', { cx: '12', cy: '12', r: '10' }]],
  }

  test('reads a plain Lucide name, however it is spelled', () => {
    for (const written of ['file-text', 'FileText', 'file_text', 'File Text']) {
      expect(keyNamed(shapes, written), written).toBe('FileText')
    }
  })

  test('reads the names Lucide itself is inconsistent about', () => {
    expect(keyNamed(shapes, 'gamepad-2')).toBe('Gamepad2')
    expect(keyNamed(shapes, 'grid-2x2')).toBe('Grid2x2')
    expect(keyNamed(shapes, 'arrow-up-0-1')).toBe('ArrowUp01')
  })

  test('reads what the Iconize plugin writes, prefix and all', () => {
    expect(keyNamed(shapes, 'LiFileText')).toBe('FileText')
    expect(keyNamed(shapes, 'LiSmile')).toBe('Smile')
  })

  test('and does not read a prefix off a name that starts the same way', () => {
    expect(keyNamed(shapes, 'link')).toBe('Link')
    expect(keyNamed(shapes, 'list')).toBe('List')
  })

  test('a name nothing in the library answers to is nothing', () => {
    expect(keyNamed(shapes, 'FaBeer')).toBeNull()
    expect(keyNamed(shapes, 'nonsense')).toBeNull()
    expect(keyNamed(shapes, '')).toBeNull()
  })

  test('an emoji is what it is rather than a name to look up', () => {
    expect(readIcon('🚀')).toEqual({ kind: 'emoji', text: '🚀' })
    expect(readIcon('👍🏽')).toEqual({ kind: 'emoji', text: '👍🏽' })
    expect(readIcon('🇩🇪')).toEqual({ kind: 'emoji', text: '🇩🇪' })
  })

  test('and a name is a name, even one with a digit in it', () => {
    expect(readIcon('file-text')).toEqual({ kind: 'lucide', name: 'file-text' })
    expect(readIcon('  grid-2x2  ')).toEqual({ kind: 'lucide', name: 'grid-2x2' })
    expect(readIcon('2')).toEqual({ kind: 'lucide', name: '2' })
  })

  test('nothing written is nothing chosen', () => {
    expect(readIcon(null)).toBeNull()
    expect(readIcon('')).toBeNull()
    expect(readIcon('   ')).toBeNull()
  })

  test('a note is written with the name in the spelling Lucide uses', () => {
    expect(iconValue('FileText')).toBe('file-text')
    expect(iconValue('Gamepad2')).toBe('gamepad-2')
    expect(iconValue('AArrowDown')).toBe('a-arrow-down')
    expect(iconValue('Smile')).toBe('smile')
  })

  /** Whatever is written has to read back as the icon it was chosen for, which is
   *  the round trip that keeps an icon from disappearing on the next open. */
  test('and reads back as the icon it was written for', () => {
    for (const key of Object.keys(shapes)) {
      expect(keyNamed(shapes, iconValue(key)), key).toBe(key)
    }
  })
})

/** A library standing in for Lucide's, for the blocks below: the names they name, and
 *  nothing else, so a test says what it depends on. */
const LIBRARY: Record<string, IconNode> = {
  FileText: [['path', { d: 'M4 2h9l5 5v15H4z' }]],
  Rocket: [['path', { d: 'M4 20l6-6' }]],
  Link: [['path', { d: 'M9 15l6-6' }]],
  List: [['path', { d: 'M8 6h13' }]],
}

/** One string says which of three sets an icon came from and which icon it is. What
 *  is written has to read back as the icon it was chosen for, or an icon disappears
 *  on the next open - and it has to stay something Obsidian's Iconize can show, which
 *  is why a Lucide name has no prefix in front of it. */
describe('what each kind of icon is written as', () => {
  test('an emoji is the character, and nothing is added to it', () => {
    expect(writtenIcon(EMOJI_SET, '🚀')).toBe('🚀')
    expect(readIcon(writtenIcon(EMOJI_SET, '🚀'))).toEqual({ kind: 'emoji', text: '🚀' })
  })

  test('a line icon is Lucide s own plain name, with no set in front of it', () => {
    expect(writtenIcon(LUCIDE, 'FileText')).toBe('file-text')
    expect(readIcon('file-text')).toEqual({ kind: 'lucide', name: 'file-text' })
  })

  test('and anything else names its own set first', () => {
    expect(writtenIcon('flat-color-icons', 'calendar')).toBe('flat-color-icons:calendar')
    expect(readIcon('flat-color-icons:calendar')).toEqual({
      kind: 'set',
      set: 'flat-color-icons',
      name: 'calendar',
    })
  })

  /** A set this build has never heard of is a value a newer nib wrote. It reads as
   *  what it says rather than as a Lucide name, so the row falls back to its kind's
   *  mark instead of drawing the wrong picture. */
  test('a set nothing here knows is still read as a set', () => {
    expect(readIcon('some-future-set:thing')).toEqual({
      kind: 'set',
      set: 'some-future-set',
      name: 'thing',
    })
  })

  test('`lucide:` written by hand means what a bare name means', () => {
    expect(readIcon('lucide:rocket')).toEqual({ kind: 'lucide', name: 'rocket' })
  })

  /** A colon in a name that is not a set's - a Windows path somebody pasted, a word
   *  with a colon in it - is not a prefix: a set's id is lowercase letters. */
  test('a value that only looks prefixed is a name', () => {
    expect(readIcon('C:/notes/rocket')).toEqual({ kind: 'lucide', name: 'C:/notes/rocket' })
    expect(readIcon('Note: a rocket')).toEqual({ kind: 'lucide', name: 'Note: a rocket' })
  })

  test('every value reads back as the icon it was written for', () => {
    for (const [set, name] of [
      [LUCIDE, 'FileText'],
      [EMOJI_SET, '🚀'],
      ['flat-color-icons', 'calendar'],
    ] as const) {
      const said = writtenIcon(set, name)
      const read = readIcon(said)

      expect(read, said).not.toBeNull()
      if (read?.kind === 'emoji') expect(read.text).toBe(name)
      else if (read?.kind === 'set') expect(read.name).toBe(name)
      else expect(keyNamed(LIBRARY, read?.name ?? '')).toBe(name)
    }
  })
})

/** Obsidian's Iconize puts a two-letter pack prefix in front of every name it writes.
 *  Nib ships one stroked set, so a name out of any pack is looked up in Lucide without
 *  its prefix, which is the right answer far more often than nothing at all. */
describe('a name a vault brought in from Iconize', () => {
  test('finds the same icon whichever pack it came from', () => {
    for (const name of ['LiRocket', 'FaRocket', 'RiRocket', 'BxRocket']) {
      expect(keyNamed(LIBRARY, name), name).toBe('Rocket')
    }
  })

  test('and a name that is a word beginning with a pack s letters is still itself', () => {
    expect(keyNamed(LIBRARY, 'Link')).toBe('Link')
    expect(keyNamed(LIBRARY, 'List')).toBe('List')
  })
})

/** Two spellings of one icon are one icon, which is what lets the picker show the one
 *  already worn as chosen however it was written. */
describe('telling two written values apart', () => {
  test('the same icon spelled three ways is the same icon', () => {
    expect(sameIcon('FileText', 'file-text')).toBe(true)
    expect(sameIcon('LiFileText', 'file-text')).toBe(false)
    expect(sameIcon('file_text', 'file-text')).toBe(true)
  })

  test('and two different ones are not', () => {
    expect(sameIcon('rocket', 'anchor')).toBe(false)
    expect(sameIcon('rocket', null)).toBe(false)
    expect(sameIcon(null, null)).toBe(true)
  })

  test('a set s own name is compared as it stands', () => {
    expect(sameIcon('flat-color-icons:calendar', 'flat-color-icons:calendar')).toBe(true)
    expect(sameIcon('flat-color-icons:calendar', 'calendar')).toBe(false)
  })

  test('and so is an emoji', () => {
    expect(sameIcon('🚀', '🚀')).toBe(true)
    expect(sameIcon('🚀', '⚓')).toBe(false)
  })
})

/** The colour a stroked icon may be drawn in: one of the accents the app already
 *  offers, by its own id, so a file that names one still means something in next
 *  year's palette. */
describe('the colour an icon is drawn in', () => {
  test('is one of the accents, however it was capitalised', () => {
    expect(readTint('violet')).toBe('violet')
    expect(readTint(' Teal ')).toBe('teal')
    expect(isIconTint('red')).toBe(true)
  })

  test('and nothing else is one', () => {
    expect(readTint('chartreuse')).toBeNull()
    expect(readTint('#ff0000')).toBeNull()
    expect(readTint('')).toBeNull()
    expect(readTint(null)).toBeNull()
    expect(isIconTint('chartreuse')).toBe(false)
  })
})

/** One search field over three sets that name things three different ways. */
describe('searching a set whose names are already words', () => {
  const emoji = [
    { name: '🚀', words: 'rocket rocket' },
    { name: '💰', words: 'money bag money bag' },
    { name: '📅', words: 'calendar calendar' },
  ]

  test('finds one by the words it is called', () => {
    expect(rankIcons(emoji, 'money')).toEqual(['💰'])
    expect(rankIcons(emoji, 'rocket')).toEqual(['🚀'])
  })

  test('finds one by a word inside its name', () => {
    expect(rankIcons(emoji, 'bag')).toEqual(['💰'])
  })

  test('and an empty query is the set s own order', () => {
    expect(rankIcons(emoji, '')).toEqual(['🚀', '💰', '📅'])
  })

  test('nothing matching is nothing', () => {
    expect(rankIcons(emoji, 'aardvark')).toEqual([])
  })
})
