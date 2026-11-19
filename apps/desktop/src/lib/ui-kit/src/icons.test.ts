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
  test.each([
    ['BookOpen', 'book open'],
    ['CalendarDays', 'calendar days'],
    ['RSSFeed', 'rss feed'],
    ['Building2', 'building2'],
  ])('splits the humps of %s, keeping capitals and digits with their word', (name, said) => {
    expect(words(name)).toBe(said)
  })
})
describe('searching the library', () => {
  test('puts the exact name first, a whole word above a fragment, in any case', () => {
    expect(search(NAMES, 'book')[0]).toBe('Book')
    expect(search(NAMES, 'BOOK')[0]).toBe('Book')
    expect(search(NAMES, 'star')[0]).toBe('Star')
    expect(search(NAMES, 'book')).toContain('BookOpen')
    expect(search(NAMES, 'book open')[0]).toBe('BookOpen')
    const found = search(NAMES, 'book')
    expect(found.indexOf('BookOpen')).toBeLessThan(found.indexOf('BookmarkMinus'))
  })
  test('understands words that are not icon names, their plurals, inside a longer query', () => {
    for (const [query, name] of [
      ['work', 'Briefcase'],
      ['uni', 'GraduationCap'],
      ['journal', 'NotebookPen'],
      ['notes', 'NotebookPen'],
      ['work journal', 'Briefcase'],
      ['work journal', 'NotebookPen'],
      ['grduation', 'GraduationCap'],
    ]) {
      expect(search(NAMES, query!), query).toContain(name)
    }
    expect(search(NAMES, 'maths')).toEqual(search(NAMES, 'math'))
    expect(search(NAMES, 'calndar')[0]).toBe('Calendar')
  })
  test('never puts a near miss ahead of a name that matches', () => {
    const entries = [
      { name: 'Building2', words: 'building2' },
      { name: 'Bug', words: 'bug' },
    ]
    expect(rankIcons(entries, 'bug')).toEqual(['Bug', 'Building2'])
  })
  test('gives back the whole set for an empty query, nothing for no match, and honours the limit', () => {
    expect(search(NAMES, '  ').length).toBe(NAMES.length)
    expect(search(NAMES, 'zzzzz')).toEqual([])
    expect(search(NAMES, '', 3).length).toBe(3)
  })
})
describe('the mark a space wears', () => {
  const CAP: IconNode = [['path', { d: 'M21 10l-9-4-9 4 9 4z' }]]
  const library: Record<string, IconNode> = { GraduationCap: CAP }
  test('is the shape it chose, its initial where it chose none, and never nothing', () => {
    expect(shapeFor(library, 'GraduationCap')).toBe(CAP)
    expect(shapeFor(library, null)).toBeNull()
    expect(shapeFor(library, 'NoSuchIcon')).toBeNull()
    expect(shapeFor({}, 'GraduationCap')).toBeNull()
    for (const [name, mark] of [
      ['Uni', 'U'],
      ['  notes', 'N'],
      ['ubung', 'U'],
      ['   ', '·'],
    ]) {
      expect(initial(name!)).toBe(mark)
    }
  })
})
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
  test.each([
    ['file-text', 'FileText'],
    ['FileText', 'FileText'],
    ['file_text', 'FileText'],
    ['File Text', 'FileText'],
    ['gamepad-2', 'Gamepad2'],
    ['grid-2x2', 'Grid2x2'],
    ['arrow-up-0-1', 'ArrowUp01'],
    ['LiFileText', 'FileText'],
    ['LiSmile', 'Smile'],
    ['link', 'Link'],
    ['list', 'List'],
    ['FaBeer', null],
    ['nonsense', null],
    ['', null],
  ])('reads %j, however Lucide or Iconize spell it, as %s', (written, key) => {
    expect(keyNamed(shapes, written)).toBe(key)
  })
  test.each([
    ['🚀', { kind: 'emoji', text: '🚀' }],
    ['👍🏽', { kind: 'emoji', text: '👍🏽' }],
    ['🇩🇪', { kind: 'emoji', text: '🇩🇪' }],
    ['file-text', { kind: 'lucide', name: 'file-text' }],
    ['  grid-2x2  ', { kind: 'lucide', name: 'grid-2x2' }],
    ['2', { kind: 'lucide', name: '2' }],
    [null, null],
    ['', null],
    ['   ', null],
    ['flat-color-icons:calendar', { kind: 'set', set: 'flat-color-icons', name: 'calendar' }],
    ['some-future-set:thing', { kind: 'set', set: 'some-future-set', name: 'thing' }],
    ['lucide:rocket', { kind: 'lucide', name: 'rocket' }],
    ['C:/notes/rocket', { kind: 'lucide', name: 'C:/notes/rocket' }],
    ['Note: a rocket', { kind: 'lucide', name: 'Note: a rocket' }],
  ])('reads %j as an emoji, a name or a set', (written, read) => {
    expect(readIcon(written)).toEqual(read)
  })
  test('a note is written with the name in the spelling Lucide uses, and reads back as it', () => {
    expect(iconValue('FileText')).toBe('file-text')
    expect(iconValue('Gamepad2')).toBe('gamepad-2')
    expect(iconValue('AArrowDown')).toBe('a-arrow-down')
    expect(iconValue('Smile')).toBe('smile')
    for (const key of Object.keys(shapes)) {
      expect(keyNamed(shapes, iconValue(key)), key).toBe(key)
    }
  })
})
const LIBRARY: Record<string, IconNode> = {
  FileText: [['path', { d: 'M4 2h9l5 5v15H4z' }]],
  Rocket: [['path', { d: 'M4 20l6-6' }]],
  Link: [['path', { d: 'M9 15l6-6' }]],
  List: [['path', { d: 'M8 6h13' }]],
}
describe('what each kind of icon is written as', () => {
  test('an emoji is the character, a line icon Lucide s plain name, anything else names its set', () => {
    expect(writtenIcon(EMOJI_SET, '🚀')).toBe('🚀')
    expect(writtenIcon(LUCIDE, 'FileText')).toBe('file-text')
    expect(writtenIcon('flat-color-icons', 'calendar')).toBe('flat-color-icons:calendar')
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
describe('a name a vault brought in from Iconize', () => {
  test('finds the same icon whichever pack it came from, and a word with a pack s letters is itself', () => {
    for (const name of ['LiRocket', 'FaRocket', 'RiRocket', 'BxRocket']) {
      expect(keyNamed(LIBRARY, name), name).toBe('Rocket')
    }
    expect(keyNamed(LIBRARY, 'Link')).toBe('Link')
    expect(keyNamed(LIBRARY, 'List')).toBe('List')
  })
})
describe('telling two written values apart', () => {
  test.each([
    ['FileText', 'file-text', true],
    ['LiFileText', 'file-text', false],
    ['file_text', 'file-text', true],
    ['rocket', 'anchor', false],
    ['rocket', null, false],
    [null, null, true],
    ['flat-color-icons:calendar', 'flat-color-icons:calendar', true],
    ['flat-color-icons:calendar', 'calendar', false],
    ['🚀', '🚀', true],
    ['🚀', '⚓', false],
  ])('%j and %j are the same icon: %s', (one, other, same) => {
    expect(sameIcon(one, other)).toBe(same)
  })
})
describe('the colour an icon is drawn in', () => {
  test('is one of the accents, however it was capitalised, and nothing else is one', () => {
    expect(readTint('violet')).toBe('violet')
    expect(readTint(' Teal ')).toBe('teal')
    expect(isIconTint('red')).toBe(true)
    for (const one of ['chartreuse', '#ff0000', '', null]) expect(readTint(one)).toBeNull()
    expect(isIconTint('chartreuse')).toBe(false)
  })
})
describe('searching a set whose names are already words', () => {
  const emoji = [
    { name: '🚀', words: 'rocket rocket' },
    { name: '💰', words: 'money bag money bag' },
    { name: '📅', words: 'calendar calendar' },
  ]
  test.each([
    ['money', ['💰']],
    ['rocket', ['🚀']],
    ['bag', ['💰']],
    ['', ['🚀', '💰', '📅']],
    ['aardvark', []],
  ])('%j finds by the words it is called or inside them, empty in the set s order', (query, found) => {
    expect(rankIcons(emoji, query)).toEqual(found)
  })
})
describe('searching by what an icon is for rather than what it is called', () => {
  const entries = [
    { name: 'Angle', words: 'angle', terms: 'degree corner geometry measure math' },
    { name: 'Parentheses', words: 'parentheses', terms: 'brackets math' },
    { name: 'Mathematician', words: 'mathematician' },
    { name: 'Calendar', words: 'calendar', terms: 'date month year event' },
    { name: 'Update', words: 'update' },
  ]
  test('finds one by its keywords, the name first, a whole keyword ahead of a fragment, not letters', () => {
    expect(rankIcons(entries, 'math')).toContain('Angle')
    expect(rankIcons(entries, 'geometry')).toEqual(['Angle'])
    expect(rankIcons(entries, 'math')[0]).toBe('Mathematician')
    expect(rankIcons(entries, 'date')).toEqual(['Calendar', 'Update'])
    expect(rankIcons(entries, 'dgm')).toEqual([])
  })
})
