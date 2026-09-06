import { describe, expect, test } from 'vitest'
import {
  blockIdOf,
  blockIds,
  findLinks,
  formatWikilink,
  isNoteTarget,
  linkTarget,
  parseWikilink,
  shownText,
  withoutBlockIds,
} from './links'

describe('what is between the brackets', () => {
  test('a bare name', () => {
    expect(parseWikilink('Note')).toEqual({
      target: 'Note',
      heading: null,
      block: null,
      alias: null,
      embed: false,
    })
  })

  test('a name with spaces and letters of any script', () => {
    expect(parseWikilink('Mémo für Späteres')?.target).toBe('Mémo für Späteres')
    expect(parseWikilink('日本語のノート')?.target).toBe('日本語のノート')
    expect(parseWikilink('folder/Some Note.md')?.target).toBe('folder/Some Note.md')
  })

  test('space around the name is not part of it', () => {
    expect(parseWikilink('  Note  ')?.target).toBe('Note')
  })

  test('the bar names what to show', () => {
    expect(parseWikilink('Note|shown text')).toMatchObject({
      target: 'Note',
      alias: 'shown text',
    })
  })

  test('everything after the first bar is the alias, bars included', () => {
    expect(parseWikilink('Note|a | b')?.alias).toBe('a | b')
  })

  test('the hash names a heading', () => {
    expect(parseWikilink('Note#Some Heading')).toMatchObject({
      target: 'Note',
      heading: 'Some Heading',
      block: null,
    })
  })

  test('hash caret names a block', () => {
    expect(parseWikilink('Note#^abc123')).toMatchObject({
      target: 'Note',
      heading: null,
      block: 'abc123',
    })
  })

  test('a heading and an alias together', () => {
    expect(parseWikilink('Note#Heading|shown')).toMatchObject({
      target: 'Note',
      heading: 'Heading',
      alias: 'shown',
    })
  })

  test('no target means this note', () => {
    expect(parseWikilink('#Heading')).toMatchObject({ target: '', heading: 'Heading' })
    expect(parseWikilink('#^abc')).toMatchObject({ target: '', block: 'abc' })
  })

  test('nothing to point at is not a link', () => {
    expect(parseWikilink('')).toBeNull()
    expect(parseWikilink('   ')).toBeNull()
    expect(parseWikilink('|only an alias')).toBeNull()
  })

  test('an embed says so', () => {
    expect(parseWikilink('Note', true)?.embed).toBe(true)
  })
})

describe('a link written back as source', () => {
  const round = (inner: string, embed = false) => {
    const link = parseWikilink(inner, embed)
    expect(link).not.toBeNull()
    return link && formatWikilink(link)
  }

  test('comes out as it went in', () => {
    expect(round('Note')).toBe('[[Note]]')
    expect(round('Note|shown')).toBe('[[Note|shown]]')
    expect(round('Note#Heading')).toBe('[[Note#Heading]]')
    expect(round('Note#^abc123')).toBe('[[Note#^abc123]]')
    expect(round('Note#Heading|shown')).toBe('[[Note#Heading|shown]]')
    expect(round('Note', true)).toBe('![[Note]]')
    expect(round('#Heading')).toBe('[[#Heading]]')
  })
})

describe('the words a link shows', () => {
  test('the alias when it has one, the target when it does not', () => {
    expect(shownText(parseWikilink('Note|shown')!)).toBe('shown')
    expect(shownText(parseWikilink('Note#Heading')!)).toBe('Note#Heading')
    expect(linkTarget(parseWikilink('Note#^id')!)).toBe('Note#^id')
  })
})

describe('which targets belong to the space', () => {
  test('a relative path and a fragment do', () => {
    expect(isNoteTarget('Note.md')).toBe(true)
    expect(isNoteTarget('../other/Note.md')).toBe(true)
    expect(isNoteTarget('#heading')).toBe(true)
  })

  test('the web does not', () => {
    expect(isNoteTarget('https://x.dev')).toBe(false)
    expect(isNoteTarget('mailto:a@b.dev')).toBe(false)
    expect(isNoteTarget('//x.dev/a')).toBe(false)
    expect(isNoteTarget('javascript:alert(1)')).toBe(false)
  })
})

describe('finding the links in a note', () => {
  test('a wikilink with its place in the text', () => {
    const text = 'see [[Other Note]] for more'
    const [link] = findLinks(text)

    expect(link).toMatchObject({ kind: 'wikilink', target: 'Other Note', from: 4, to: 18 })
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('Other Note')
  })

  test('the target span skips the space inside the brackets', () => {
    const text = '[[ Note ]]'
    const [link] = findLinks(text)
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('Note')
  })

  test('several on one line, in the order they were written', () => {
    const found = findLinks('[[A]] and [[B|b]] and ![[C]]')
    expect(found.map((one) => one.target)).toEqual(['A', 'B', 'C'])
    expect(found.map((one) => one.embed)).toEqual([false, false, true])
  })

  test('an internal markdown link counts too', () => {
    const found = findLinks('see [the note](notes/Other.md) here')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      kind: 'markdown',
      target: 'notes/Other.md',
      alias: 'the note',
    })
  })

  test('a markdown target keeps its heading and loses its encoding', () => {
    const [link] = findLinks('[x](My%20Note.md#a-heading)')
    expect(link).toMatchObject({ target: 'My Note.md', heading: 'a-heading' })
  })

  test('an angled markdown target holds spaces', () => {
    const text = '[x](<My Note.md>)'
    const [link] = findLinks(text)
    expect(link?.target).toBe('My Note.md')
    expect(text.slice(link!.targetFrom, link!.targetTo)).toBe('My Note.md')
  })

  test('a link out at the web is not a link between notes', () => {
    expect(findLinks('[x](https://x.dev) [y](mailto:a@b.dev)')).toEqual([])
  })

  test('a fenced block holds no links', () => {
    expect(findLinks('```\n[[Note]]\n```\n[[Real]]').map((one) => one.target)).toEqual(['Real'])
    expect(findLinks('~~~md\n[[Note]]\n~~~').map((one) => one.target)).toEqual([])
  })

  test('inline code holds no links', () => {
    expect(findLinks('write `[[Note]]` to link').map((one) => one.target)).toEqual([])
    expect(findLinks('`a` [[Note]] `b`').map((one) => one.target)).toEqual(['Note'])
  })

  test('a code span that never closes is text', () => {
    expect(findLinks('` [[Note]]').map((one) => one.target)).toEqual(['Note'])
  })

  test('a double backtick span holds a backtick and still hides a link', () => {
    expect(findLinks('`` ` [[Note]] `` [[Real]]').map((one) => one.target)).toEqual(['Real'])
  })

  test('an escaped bracket is not a link', () => {
    expect(findLinks('\\[[Note]]')).toEqual([])
    expect(findLinks('\\[label](Note.md)')).toEqual([])
  })

  test('a link inside a heading or a list is still a link', () => {
    expect(findLinks('# See [[Note]]\n- and [[Other]]').map((one) => one.target)).toEqual([
      'Note',
      'Other',
    ])
  })

  test('brackets inside the link end it, the way Obsidian does', () => {
    expect(findLinks('[[a]b]]')).toEqual([])
  })

  test('a same-note anchor is found with an empty target', () => {
    expect(findLinks('[[#Heading]]')[0]).toMatchObject({ target: '', heading: 'Heading' })
  })

  test('positions hold across lines', () => {
    const text = 'first\nsecond [[Note]]'
    const [link] = findLinks(text)
    expect(text.slice(link!.from, link!.to)).toBe('[[Note]]')
  })
})

describe('block names', () => {
  test('a caret word at the end of a line names the block', () => {
    expect(blockIdOf('Some paragraph. ^abc123')).toBe('abc123')
    expect(blockIdOf('^on-its-own')).toBe('on-its-own')
  })

  test('anything else is not a name', () => {
    expect(blockIdOf('a^b')).toBeNull()
    expect(blockIdOf('^abc in the middle')).toBeNull()
    expect(blockIdOf('x^2^ is a superscript')).toBeNull()
  })

  test('every name in a note, with its line', () => {
    expect(blockIds('one ^a\n\ntwo ^b')).toEqual([
      { id: 'a', line: 0 },
      { id: 'b', line: 2 },
    ])
  })

  test('a fence holds no names', () => {
    expect(blockIds('```\nxor eax ^a\n```')).toEqual([])
  })

  test('a note without them comes back exactly as it was', () => {
    const note = '# Title\n\nWords, and x^2 as well.\n'
    expect(withoutBlockIds(note)).toBe(note)
  })

  test('a name goes, and the space that separated it goes with it', () => {
    expect(withoutBlockIds('A paragraph. ^abc123\n\nmore')).toBe('A paragraph.\n\nmore')
    expect(withoutBlockIds('^on-its-own\n')).toBe('\n')
  })

  test('several go, and nothing between them moves', () => {
    expect(withoutBlockIds('one ^a\n\ntwo ^b\n\nthree')).toBe('one\n\ntwo\n\nthree')
  })

  test('a caret inside code stays', () => {
    expect(withoutBlockIds('```\nxor eax ^a\n```')).toBe('```\nxor eax ^a\n```')
  })
})
