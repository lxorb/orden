import { describe, expect, test } from 'vitest'
import {
  iconValue,
  type IconNode,
  initial,
  keyNamed,
  readIcon,
  search,
  shapeFor,
  words,
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

/** What a space in the rail actually draws.
 *
 *  Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
 *  plugin right now."* The cause was elsewhere - the storage the chosen name is read
 *  from; see lib/even/first.ts - but the rule the rail follows is here, and the half
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
