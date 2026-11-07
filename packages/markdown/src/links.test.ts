import { describe, expect, test } from 'vitest'
import { linearly } from '../../../scripts/growth'
import { namedBlock } from './block-names'
import fenceTable from './fence-table.json'
import { CodeBlocks } from './fences'
import { renderMarkdown } from './index'
import {
  blockIdOf,
  blockIds,
  decodeTarget,
  blocksOf,
  embedKind,
  encodeTarget,
  embedSize,
  findLinks,
  foldName,
  formatWikilink,
  isAudioTarget,
  labelEnds,
  sizedAlt,
  isNoteTarget,
  isCanvasTarget,
  isImageTarget,
  isPdfTarget,
  isTabFile,
  isVideoTarget,
  isWebTarget,
  MOST_LINKS,
  linkTarget,
  pageFragment,
  wikilinkCannotName,
  parseWikilink,
  headingsOf,
  sectionOf,
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

  test('a bar escaped for a table cell', () => {
    expect(parseWikilink('Note\\|shown')).toMatchObject({ target: 'Note', alias: 'shown' })
    expect(parseWikilink('Note#Part\\|shown')?.heading).toBe('Part')

    const text = '| a |\n| - |\n| [[Note\\|shown]] |'
    const [link] = findLinks(text)
    expect(link?.target).toBe('Note')
    expect(link && text.slice(link.targetFrom, link.targetTo)).toBe('Note')
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

describe('which targets name a PDF', () => {
  test('anything ending in the extension, in either case', () => {
    expect(isPdfTarget('paper.pdf')).toBe(true)
    expect(isPdfTarget('reading/Deep Learning.PDF')).toBe(true)
    expect(isPdfTarget('  paper.pdf  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isPdfTarget('paper')).toBe(false)
    expect(isPdfTarget('paper.pdf.md')).toBe(false)
    expect(isPdfTarget('pdf')).toBe(false)
    expect(isPdfTarget('')).toBe(false)
  })
})

describe('which targets name a canvas', () => {
  test('anything ending in the extension, in either case', () => {
    expect(isCanvasTarget('Board.canvas')).toBe(true)
    expect(isCanvasTarget('boards/Quarter.CANVAS')).toBe(true)
    expect(isCanvasTarget('  Board.canvas  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isCanvasTarget('Board')).toBe(false)
    expect(isCanvasTarget('Board.canvas.md')).toBe(false)
    expect(isCanvasTarget('canvas')).toBe(false)
    expect(isCanvasTarget('')).toBe(false)
  })
})

describe('which targets name a picture', () => {
  test('every extension a browser draws, in either case', () => {
    expect(isImageTarget('a/b/pic.PNG')).toBe(true)
    expect(isImageTarget('shot.jpeg')).toBe(true)
    expect(isImageTarget('drawing.svg')).toBe(true)
    expect(isImageTarget('  frame.apng  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isImageTarget('Note.md')).toBe(false)
    expect(isImageTarget('Note')).toBe(false)
    expect(isImageTarget('png')).toBe(false)
    expect(isImageTarget('')).toBe(false)
  })
})

describe('which targets name sound or a film', () => {
  test('the extensions a browser plays, in either case', () => {
    expect(isAudioTarget('take.MP3')).toBe(true)
    expect(isAudioTarget('a/b/talk.m4a')).toBe(true)
    expect(isAudioTarget('  memo.opus  ')).toBe(true)
    expect(isVideoTarget('demo.mp4')).toBe(true)
    expect(isVideoTarget('clip.MOV')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isAudioTarget('Note.md')).toBe(false)
    expect(isAudioTarget('mp3')).toBe(false)
    expect(isAudioTarget('song.mp3.md')).toBe(false)
    expect(isVideoTarget('')).toBe(false)
  })
})

describe('what kind of thing an embed names', () => {
  test('one answer per file, and none for a note', () => {
    expect(embedKind('shot.png')).toBe('image')
    expect(embedKind('take.mp3')).toBe('audio')
    expect(embedKind('demo.mp4')).toBe('video')
    expect(embedKind('paper.pdf')).toBe('pdf')
    expect(embedKind('Board.canvas')).toBe('canvas')
    expect(embedKind('Another note')).toBe(null)
    expect(embedKind('')).toBe(null)
  })

  test('a container either can be in is read as what it usually holds', () => {
    expect(embedKind('a.webm')).toBe('video')
    expect(embedKind('a.weba')).toBe('audio')
    expect(embedKind('a.ogg')).toBe('audio')
    expect(embedKind('a.ogv')).toBe('video')
  })

  test('is a wider question than what opens in a tab of its own', () => {
    expect(embedKind('take.mp3')).toBe('audio')
    expect(isTabFile('take.mp3')).toBe(false)
  })
})

describe('the size an embed asks for', () => {
  test('a width on its own, or a width and a height', () => {
    expect(embedSize('300')).toEqual({ width: 300, height: null })
    expect(embedSize('300x200')).toEqual({ width: 300, height: 200 })
  })

  test('and nothing at all for words', () => {
    expect(embedSize('the sketch')).toBe(null)
    expect(embedSize('300 wide')).toBe(null)
    expect(embedSize('x200')).toBe(null)
    expect(embedSize('')).toBe(null)
    expect(embedSize(null)).toBe(null)
  })
})

describe('which targets name a website', () => {
  test('a shortcut written by either system, in either case', () => {
    expect(isWebTarget('Svelte docs.url')).toBe(true)
    expect(isWebTarget('reading/Svelte docs.URL')).toBe(true)
    expect(isWebTarget('Svelte docs.webloc')).toBe(true)
    expect(isWebTarget('  Svelte docs.url  ')).toBe(true)
  })

  test('and nothing else', () => {
    expect(isWebTarget('Svelte docs')).toBe(false)
    expect(isWebTarget('Svelte docs.url.md')).toBe(false)
    expect(isWebTarget('url')).toBe(false)
    expect(isWebTarget('')).toBe(false)
  })
})

describe('which targets open in a tab of their own', () => {
  test('a PDF, a canvas and a website, and no other file', () => {
    expect(isTabFile('paper.pdf')).toBe(true)
    expect(isTabFile('Board.canvas')).toBe(true)
    expect(isTabFile('Svelte docs.url')).toBe(true)
    expect(isTabFile('Note.md')).toBe(false)
    expect(isTabFile('shot.png')).toBe(false)
    expect(isTabFile('')).toBe(false)
  })
})

describe('the page a fragment names', () => {
  test('is the number after page=', () => {
    expect(pageFragment('page=3')).toBe(3)
    expect(pageFragment('page=1')).toBe(1)
    expect(pageFragment('PAGE=12')).toBe(12)
    expect(pageFragment(' page=7 ')).toBe(7)
  })

  test('read out of a link the way it is written', () => {
    expect(pageFragment(parseWikilink('paper.pdf#page=3')?.heading ?? null)).toBe(3)
    expect(pageFragment(parseWikilink('paper.pdf')?.heading ?? null)).toBeNull()
  })

  test('is nothing for a fragment that is not one', () => {
    expect(pageFragment(null)).toBeNull()
    expect(pageFragment('Some Heading')).toBeNull()
    expect(pageFragment('page')).toBeNull()
    expect(pageFragment('page=')).toBeNull()
    expect(pageFragment('page=3a')).toBeNull()
    expect(pageFragment('pages=3')).toBeNull()
  })

  test('is nothing before the first page', () => {
    expect(pageFragment('page=0')).toBeNull()
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

  test('a markdown heading is the words it names, every escape undone', () => {
    const found = findLinks(
      '[x](Note.md#Some%20Heading) [y](Note.md#Q&A:%20why%3F) [z](Note.md#50%%20off)',
    )
    expect(found.map((one) => one.heading)).toEqual(['Some Heading', 'Q&A: why?', '50% off'])
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
  })

  test('a block closes on its own mark and on nothing else', () => {
    const shown = '```\n~~~\n[[Inside]]\n~~~\n```\n[[Real]]'
    expect(findLinks(shown).map((one) => one.target)).toEqual(['Real'])

    const named = '```\n[[One]]\n```ts\n[[Two]]\n```\n[[Real]]'
    expect(findLinks(named).map((one) => one.target)).toEqual(['Real'])
    expect(findLinks('~~~md\n[[Note]]\n~~~').map((one) => one.target)).toEqual([])
  })

  test('a block in a quote, in a list item or indented is code too', () => {
    const targets = (text: string) => findLinks(text).map((one) => one.target)
    expect(targets('> ```\n> [[Example]]\n> ```\n\n[[Real]]\n')).toEqual(['Real'])
    expect(targets('Words.\n\n    [[Example]]\n\n[[Real]]\n')).toEqual(['Real'])
    expect(targets('- a\n  ```\n  [[Example]]\n  ```\n- [[Real]]\n')).toEqual(['Real'])
    expect(targets('> see [[Quoted]]\n- and [[Listed]]\n')).toEqual(['Quoted', 'Listed'])
  })

  test('a fence in the front matter opens no code below it', () => {
    const note = '---\nscript: |\n  ```\nup: "[[Up]]"\n---\n- [ ] t [[L]]\n'
    expect(findLinks(note).map((one) => one.target)).toEqual(['Up', 'L'])
  })

  test('a shorter fence or one with a backtick in its info string closes nothing', () => {
    const targets = (text: string) => findLinks(text).map((one) => one.target)
    expect(targets('````md\n```\n````\n[[Plan]]')).toEqual(['Plan'])
    expect(targets('```a`b\n[[Plan]]')).toEqual(['Plan'])
    expect(targets('~~~md\n```js\n[[Example]]\n```\n~~~\n[[Real]]\n')).toEqual(['Real'])
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

describe('the headings a note holds', () => {
  test('in order, as the words they show', () => {
    expect(headingsOf('# One\n\ntext\n\n## Two\n')).toEqual(['One', 'Two'])
  })

  test('with the hashes some styles close one with taken off', () => {
    expect(headingsOf('## Two ##\n')).toEqual(['Two'])
    expect(headingsOf('## ##\n')).toEqual([''])
  })

  test('keeping a hash that is a letter of the last word', () => {
    expect(headingsOf('# C# and F#\n')).toEqual(['C# and F#'])
  })

  test('and none from inside a fence', () => {
    expect(headingsOf('```\n# Not one\n```\n# One\n')).toEqual(['One'])
  })

  test('and none from a fence inside a list item', () => {
    const note = '- a\n  ```\n  # Not one\n  ```\n\n# One\n\nwords\n'
    expect(headingsOf(note)).toEqual(['One'])
    expect(sectionOf(note, { heading: 'Not one', block: null })).toBe(null)
    expect(
      sectionOf('# One\n\n- a\n  ```\n  # Two\n  ```\n', { heading: 'One', block: null }),
    ).toBe('# One\n\n- a\n  ```\n  # Two\n  ```')
  })
})

describe('the part of a note a link points into', () => {
  test('a heading names the section under it', () => {
    const note = '# One\n\nfirst\n\n# Two\n\nsecond\n'
    expect(sectionOf(note, { heading: 'Two', block: null })).toBe('# Two\n\nsecond')
    expect(sectionOf(note, { heading: 'Nowhere', block: null })).toBe(null)
  })

  test('found by the words it shows, closing hashes and all', () => {
    const note = '# C# and F# #\n\nwords\n'
    expect(sectionOf(note, { heading: 'C# and F#', block: null })).toBe('# C# and F# #\n\nwords')
  })

  test('and a note with no heading named is the whole of it', () => {
    expect(sectionOf('words\n', { heading: null, block: null })).toBe('words\n')
  })

  test('a heading an Obsidian link writes percent-encoded finds its section', () => {
    const note = '# Some Heading\n\nwords\n'
    const [link] = findLinks('[x](Note.md#Some%20Heading)')
    expect(sectionOf(note, link!)).toBe('# Some Heading\n\nwords')
  })

  test('a note written on Windows has its headings and its block names', () => {
    const note = '# Title\r\n\r\npara ^abc1\r\n'
    expect(headingsOf(note)).toEqual(['Title'])
    expect(blockIds(note)).toEqual([{ id: 'abc1', line: 2 }])
    expect(sectionOf(note, { heading: 'Title', block: null })).toBe('# Title\r\n\r\npara ^abc1')
    expect(sectionOf(note, { heading: null, block: 'abc1' })).toBe('para')
    expect(withoutBlockIds(note)).toBe('# Title\r\n\r\npara\r\n')
  })
})

describe('how many links one note is read for', () => {
  test('is the same ceiling the crate keeps', () => {
    expect(MOST_LINKS).toBe(5000)
  })

  test('and a note that says it more often than that is read to the ceiling', () => {
    const many = findLinks(['[[A]] '.repeat(4000), '[[B]] '.repeat(4000), ''].join('\n'))

    expect(many).toHaveLength(MOST_LINKS)
    expect(many[0]?.target).toBe('A')
  })

  test('while a note anybody wrote is read whole', () => {
    expect(findLinks('see [[A]] and [[B]]')).toHaveLength(2)
  })
})

describe('a name as something to compare', () => {
  const composed = 'Übersicht'
  const decomposed = 'U\u0308bersicht'

  test('is one name however its letters are composed', () => {
    expect(decomposed).not.toBe(composed)
    expect(foldName(decomposed)).toBe(foldName(composed))
  })

  test('and whatever its case', () => {
    expect(foldName('ÜBERSICHT')).toBe(foldName(decomposed))
  })
})

describe('links after code that only looks like a fence', () => {
  test('are found after a line of inline code in three backticks', () => {
    const found = findLinks('```x```\n[[Target]] and [l](Other.md)\n')
    expect(found.map((link) => link.target)).toEqual(['Target', 'Other.md'])
  })

  test('are not found inside a code span with a longer run inside it', () => {
    const found = findLinks('`` a ``` ` [[Hidden]] `` [[Target]]')
    expect(found.map((link) => link.target)).toEqual(['Target'])
  })
})

describe('a markdown link that never closes', () => {
  test('is turned away in linear time, however many blanks follow it', () => {
    expect(linearly((n) => findLinks(`[a](b${' '.repeat(n)}x`), 100_000)).toEqual([])
    expect(linearly((n) => findLinks(`[a](<b>${' '.repeat(n)}"t" x`), 100_000)).toEqual([])
  }, 60_000)

  test('still reads a title after blanks, and blanks with no title', () => {
    const found = findLinks('[a](One.md   "title"  ) [b](<Two.md>   )')
    expect(found.map((link) => link.target)).toEqual(['One.md', 'Two.md'])
  })
})

describe('a markdown target the way a link names a file', () => {
  const only = (text: string) => findLinks(text).map((link) => link.target)

  test('every escape is undone, reserved characters too, as links.rs reads it', () => {
    expect(only('[S](C%23.md)')).toEqual(['C#.md'])
    expect(only('[S](Why%3F.md)')).toEqual(['Why?.md'])
    expect(only('[S](a%2520b.md)')).toEqual(['a%20b.md'])
    expect(decodeTarget('100%')).toBe('100%')
    expect(decodeTarget('a%20b%')).toBe('a b%')
    expect(decodeTarget('%FF.md')).toBe('%FF.md')
  })

  test('the hash in an escape is no fragment, and one written out still is', () => {
    const [link] = findLinks('[S](C%23.md#a%20b)')
    expect(link).toMatchObject({ target: 'C#.md', heading: 'a b' })
  })

  test('what encodeTarget writes reads back as the same name', () => {
    for (const name of [
      'C#.md',
      'Why?.md',
      'a (1).md',
      '100%.md',
      'a%20b.md',
      'a[b].md',
      'é ü.md',
    ]) {
      expect(decodeTarget(encodeTarget(name))).toBe(name)
      expect(only(`[S](${encodeTarget(name)})`)).toEqual([name])
    }
  })

  test('a rename finds the target as it is written, not as it is read', () => {
    const text = '[S](C%23.md#h)'
    const [link] = findLinks(text)
    expect(text.slice(link?.targetFrom, link?.targetTo)).toBe('C%23.md')
  })
})

describe('parentheses and brackets in a markdown link', () => {
  const read = (text: string) =>
    findLinks(text).map((link) => [
      link.target,
      link.alias,
      text.slice(link.targetFrom, link.targetTo),
    ])

  test('a target holds balanced parentheses, which is how Obsidian writes `a (1).md`', () => {
    expect(read('[x](a%20(1).md)')).toEqual([['a (1).md', 'x', 'a%20(1).md']])
    expect(read('[x](a(1).md)')).toEqual([['a(1).md', 'x', 'a(1).md']])
    expect(read('[x](a((1)).md)')).toEqual([['a((1)).md', 'x', 'a((1)).md']])
    expect(read('[x](a(1).md "t") [y](b.md)').map(([target]) => target)).toEqual([
      'a(1).md',
      'b.md',
    ])
  })

  test('escaped parentheses are the name and count for nothing', () => {
    expect(read('[x](a\\(1.md)')).toEqual([['a(1.md', 'x', 'a\\(1.md']])
  })

  test('parentheses that do not balance are no link, or end it where they close', () => {
    expect(findLinks('[x](a(1.md)')).toEqual([])
    expect(read('[x](a)1).md)').map(([target]) => target)).toEqual(['a'])
  })

  test('a label holds balanced brackets and escaped ones', () => {
    expect(read('[a[b]c](d.md)')).toEqual([['d.md', 'a[b]c', 'd.md']])
    expect(read('[a\\]b](d.md)')).toEqual([['d.md', 'a\\]b', 'd.md']])
    expect(findLinks('[a[b](d.md)').map((link) => link.alias)).toEqual(['b'])
  })

  test('an inner link is the link and the outer one is not', () => {
    expect(read('[a[b](c.md)d](e.md)').map(([target]) => target)).toEqual(['c.md'])
    expect(findLinks('[![i](p.png)](e.md)').map((link) => [link.target, link.embed])).toEqual([
      ['p.png', true],
    ])
  })

  test('a wikilink is never read as a label', () => {
    expect(findLinks('[[a]](b.md)').map((link) => [link.kind, link.target])).toEqual([
      ['wikilink', 'a'],
    ])
    expect(findLinks('[x [[a]] y](b.md)').map((link) => link.target)).toEqual(['a'])
  })

  test('words between the target and the bracket are no link, as in CommonMark', () => {
    expect(findLinks('[x](a b.md)')).toEqual([])
    expect(findLinks('[x](<a<b>)')).toEqual([])
  })

  test('a backslash before the bang leaves the link and escapes only the bang', () => {
    expect(findLinks('\\![x](a.md)').map((link) => link.embed)).toEqual([false])
  })

  test('what a link may cost is bounded, as in links.rs', () => {
    const long = 'x'.repeat(1000)
    expect(findLinks(`[a](${long}.md)`)).toEqual([])
    expect(findLinks(`[${long}](a.md)`)).toEqual([])
    expect(findLinks('[a]('.repeat(5000))).toEqual([])
    expect(findLinks(`[a](${'('.repeat(100000)}`)).toEqual([])
  })
})

describe('what a wikilink cannot name', () => {
  test('the characters its own grammar or Obsidian takes for something else', () => {
    for (const name of ['C# basics', 'a^b', 'a[b]', 'a]b', 'a|b']) {
      expect(wikilinkCannotName(name)).toBe(true)
    }
    for (const name of ['Plan', 'a (1)', 'folder/Plan', 'é ü', 'a&b']) {
      expect(wikilinkCannotName(name)).toBe(false)
    }
  })
})

describe('a size after a bar in a picture words', () => {
  test.each([
    ['|100x200', '', { width: 100, height: 200 }],
    ['\\|300', '', { width: 300, height: null }],
    ['a cat|300', 'a cat', { width: 300, height: null }],
    ['a|b', 'a|b', null],
    ['300', '300', null],
    ['', '', null],
  ])('%j', (alt, words, size) => {
    expect(sizedAlt(alt)).toEqual({ alt: words, size })
  })
})

describe('the walk agrees with links.rs', () => {
  const read = (text: string) => findLinks(text).map((link) => [link.kind, link.target])

  test('what a markdown target holds is not a wikilink of its own', () => {
    expect(read('[x]([[a]])')).toEqual([['markdown', '[[a]]']])
    expect(read('[x](http://a/[[b]])')).toEqual([])
  })

  test('what a wikilink closes is not the label of a link', () => {
    expect(read('[[\\]](x)')).toEqual([['wikilink', '\\']])
  })

  test('order stays the order written', () => {
    expect(read('[a](b.md) [[c]] ![d](e.png) ![[f]]').map(([, one]) => one)).toEqual([
      'b.md',
      'c',
      'e.png',
      'f',
    ])
  })

  test('a blank is what JavaScript and the crate both call one', () => {
    expect(read('[x](a﻿b.md)')).toEqual([])
    expect(read('[x](a\u0085b.md)')).toEqual([['markdown', 'a\u0085b.md']])
  })
})

describe('a line of brackets that open nothing', () => {
  test('are matched once, not scanned from each', () => {
    const line = 'a['.repeat(50000)
    expect(labelEnds(line).size).toBe(0)
    expect(findLinks(line)).toEqual([])
  })

  test('and the same links are found as a scan from each bracket finds', () => {
    expect(labelEnds('[a[b]c]').get(0)).toBe(6)
    expect(labelEnds('[a[b]c]').get(2)).toBe(4)
    expect(labelEnds('[a[b](c)d]').has(0)).toBe(false)
    expect(labelEnds('[a[b](c)d]').get(2)).toBe(4)
    expect(labelEnds('[[a]').has(0)).toBe(false)
    expect(labelEnds('[[a]').get(1)).toBe(3)
    expect(labelEnds('[a\\]b]').get(0)).toBe(5)
  })
})

describe('a block name on a line of its own', () => {
  const FENCED = 'a\n\n```\nx\n\ny\n```\n\n^abc123\n\nb\n'

  test('a link to it gets the block above, whatever blank lines that holds', () => {
    expect(sectionOf(FENCED, { heading: null, block: 'abc123' })).toBe('```\nx\n\ny\n```')
    expect(sectionOf('| a |\n| - |\n\n^tab\n\nb', { heading: null, block: 'tab' })).toBe(
      '| a |\n| - |',
    )
  })

  test('a run with the name under it stays as it was', () => {
    expect(sectionOf('a\nb\n^n\n\nc', { heading: null, block: 'n' })).toBe('a\nb')
  })

  test('belongs to that block in the list of blocks', () => {
    expect(blocksOf(FENCED).map((one) => [one.line, one.id])).toEqual([
      [0, null],
      [2, 'abc123'],
      [10, null],
    ])
  })

  test('naming one writes it where it can be read', () => {
    const id = () => 'new123'

    expect(namedBlock('a\n\n```\nx\n\ny\n```\n\nb\n', 2, id)).toEqual({
      id: 'new123',
      source: 'a\n\n```\nx\n\ny\n```\n\n^new123\n\nb\n',
    })
    expect(namedBlock('| a |\r\n| - |\r\n', 0, id)?.source).toBe(
      '| a |\r\n| - |\r\n\r\n^new123\r\n',
    )
    expect(namedBlock('---\n\nb', 0, id)?.source).toBe('---\n\n^new123\n\nb')
    expect(namedBlock('words\nmore\n\nb\n', 0, id)?.source).toBe('words\nmore ^new123\n\nb\n')
    expect(namedBlock('words\r\n\r\nb', 0, id)?.source).toBe('words ^new123\r\n\r\nb')
  })

  test('naming one that has a name changes nothing', () => {
    const id = () => 'new123'

    const fence = 'a\n\n```\nx\n```\n\n^old\n'
    expect(namedBlock(fence, 2, id)).toEqual({ id: 'old', source: fence })
    expect(namedBlock('words ^old\n', 0, id)).toEqual({ id: 'old', source: 'words ^old\n' })
  })

  test('front matter takes no name', () => {
    expect(namedBlock('---\nt: x\n---\n\nb\n', 1, () => 'new123')).toBeNull()
    expect(namedBlock('a', 5, () => 'new123')).toBeNull()
  })
})

describe('naming a block by where it ends', () => {
  const id = () => 'new123'

  test.each([
    ['a fence under words', 'para\n```\nx\n```\n\nafter', 'para\n```\nx\n```\n\n^new123\n\nafter'],
    [
      'a table under words',
      'para\n\n| a |\n| - |\n| 1 |',
      'para\n\n| a |\n| - |\n| 1 |\n\n^new123',
    ],
    ['a rule under words', 'para\n***\n\nb', 'para\n***\n\n^new123\n\nb'],
    ['words with a rule under them', 'Title\n---\n\nb', 'Title\n---\n\n^new123\n\nb'],
    ['words with equals signs under them', 'Title\n===\n\nb', 'Title\n===\n\n^new123\n\nb'],
  ])('%s', (_what, source, wanted) => {
    const line = source.startsWith('para\n\n') ? 2 : 0
    expect(namedBlock(source, line, id)?.source).toBe(wanted)
  })

  test('a name under a paragraph is its name', () => {
    expect(namedBlock('para\n\n^have\n\nb', 0, id)).toEqual({
      id: 'have',
      source: 'para\n\n^have\n\nb',
    })
  })

  test('maths and a comment hold their blank lines', () => {
    expect(namedBlock('$$\na\n\nb\n$$\n', 0, id)?.source).toBe('$$\na\n\nb\n$$\n\n^new123\n')
    expect(namedBlock('<!--\na\n\nb\n-->\n', 0, id)?.source).toBe('<!--\na\n\nb\n-->\n\n^new123\n')
  })
})

describe('a size of nothing', () => {
  test('is no size: the picture is not drawn away', () => {
    expect(sizedAlt('x|0')).toEqual({ alt: 'x|0', size: null })
    expect(embedSize('0')).toBeNull()
    expect(embedSize('0x20')).toBeNull()
    expect(embedSize('300')).toEqual({ width: 300, height: null })
  })
})

describe('a closing fence an older build named', () => {
  const OLD = 'a\n\n```\nx\n``` ^abc123\n\n# After\n\nb\n'

  test('closes the fence, and the name is found', () => {
    expect(blockIds(OLD)).toEqual([{ id: 'abc123', line: 4 }])
    expect(withoutBlockIds(OLD)).toBe('a\n\n```\nx\n```\n\n# After\n\nb\n')
    expect(renderMarkdown(OLD)).toContain('<h1')
  })

  test('code that only looks like one stays code', () => {
    expect(blockIds('```\n``` ^a b\n```\n')).toEqual([])
    const shown = '```\n``` ^a b\n```\n\n[[L]] words\n'
    expect(renderMarkdown(shown)).toContain('``` ^a b')
    expect(findLinks(shown).map((one) => one.target)).toEqual(['L'])
  })

  test('on the fence that opens is its info string and no name', () => {
    const opener = '``` ^abc123\ncode\n```\n'
    expect(blockIds(opener)).toEqual([])
    expect(withoutBlockIds(opener)).toBe(opener)
  })

  test('in a quote or a list item is read past what the fence is in', () => {
    const quoted = '> ```\n> code\n> ``` ^abc123\n> words [[L]]\n'
    expect(blockIds(quoted)).toEqual([{ id: 'abc123', line: 2 }])
    expect(renderMarkdown(quoted)).not.toContain('^abc123')
    expect(renderMarkdown(quoted)).toMatch(/<p>words/)
    const listed = '- a\n\n    ```\n    code\n    ``` ^abc123\n'
    expect(blockIds(listed)).toEqual([{ id: 'abc123', line: 4 }])
    expect(renderMarkdown(listed)).not.toContain('^abc123')
  })

  test.each(fenceTable as [string, string, string[]][])('%j', (note, shape, ids) => {
    const code = new CodeBlocks()
    const said = note.split('\n').map((line) => 'wco'[code.line(line)])
    expect(said.join('')).toBe(shape)
    expect(blockIds(note).map((one) => one.id)).toEqual(ids)
  })
})

describe('a line of links nothing closes', () => {
  const quick = (source: (size: number) => string, size: number) =>
    linearly((one) => renderMarkdown(source(one)), size)

  test('renders in linear time', () => {
    expect(quick((n) => '[a]('.repeat(n), 25_000)).not.toContain('<a ')
    expect(quick((n) => '![a]('.repeat(n), 20_000)).not.toContain('<img')
    expect(quick((n) => '[a](x ('.repeat(n), 15_000)).not.toContain('<a ')
    expect(quick((n) => '[a](<'.repeat(n), 20_000)).not.toContain('<a ')
    expect(quick((n) => '[a](<x>'.repeat(n), 15_000)).not.toContain('<a ')
    expect(quick((n) => '[a](x)'.repeat(n), 16_000).split('<a ').length - 1).toBe(16_000)
  }, 60_000)

  test('reads a link that closes as before', () => {
    const cases: [string, string][] = [
      ['[a](b)', '<a href="b">a</a>'],
      ['[a](<b c>)', '<a href="b%20c">a</a>'],
      ['[a](b "t")', '<a href="b" title="t">a</a>'],
      ['[a](b (t))', '<a href="b" title="t">a</a>'],
      ['[a](b(c))', '<a href="b(c)">a</a>'],
      ['[a](b\\)c)', '<a href="b)c">a</a>'],
      ['[a]( b )', '<a href="b">a</a>'],
      ['[a]()', 'a'],
      ['[a](b)c)', '<a href="b">a</a>c)'],
      ['[a [b] c](d)', '<a href="d">a [b] c</a>'],
      ['![i](data:image/png;base64,AAAA)', '<img src="data:image/png;base64,AAAA" alt="i">'],
    ]
    for (const [source, link] of cases) expect(renderMarkdown(source)).toBe(`<p>${link}</p>\n`)
  })

  test('is no link where its parentheses do not close, as in cmark', () => {
    expect(renderMarkdown('[a](b (t(u)))')).not.toContain('<a ')
    expect(renderMarkdown('[a](((b)c d)')).not.toContain('<a ')
    expect(renderMarkdown('[a](b( "t")')).not.toContain('<a ')
    expect(renderMarkdown(`[a](${'('.repeat(33)}b${')'.repeat(33)})`)).not.toContain('<a ')
    expect(renderMarkdown(`[a](${'('.repeat(32)}b${')'.repeat(32)})`)).toContain('<a ')
  })
})
