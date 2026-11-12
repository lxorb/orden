import { describe, expect, test } from 'vitest'
import {
  frontMatter,
  frontMatterEdit,
  frontMatterEdits,
  frontMatterKeys,
  frontMatterList,
  frontMatterBlock,
  frontMatterValue,
  isPropertyName,
  opensFrontMatter,
  stripFrontMatter,
  writeFrontMatter,
} from './front-matter'
import table from './front-matter-table.json'
import { addProperty, renameProperty, writeProperty } from './property-edits'
import { renderMarkdown } from './index'

const TABLE = table as [string, boolean][]

describe('what counts as front matter', () => {
  test.each(TABLE)('%j is a block: %s', (note, block) => {
    expect(frontMatterBlock(note) !== null).toBe(block)
    expect(opensFrontMatter(note)).toBe(block)
    expect(stripFrontMatter(note)).toBe(
      frontMatterBlock(note) ? note.slice(frontMatterBlock(note)?.to ?? 0) : note,
    )
  })

  test('an indented fence inside a block scalar does not close the block', () => {
    const note = '---\ntext: |\n  a\n  ---\n  b\n---\nrest'
    expect(stripFrontMatter(note)).toBe('rest')
  })

  test('the words between two rules stay on the page and out of a writer', () => {
    const note = '---\nprose words\n---\nrest'
    expect(renderMarkdown(note)).toContain('prose words')
    expect(frontMatterEdit(note, 'icon', 'x')).toEqual({
      from: 0,
      to: 0,
      insert: '---\nicon: x\n---\n',
    })
    expect(frontMatterValue(note, 'prose words')).toBeNull()
  })
})

describe('what a writer makes is what a reader takes', () => {
  const NAMES = [
    'Date of the first meeting held',
    'Done?',
    'No. of pages',
    'Author, editor',
    '+1',
    'Nr. der Rechnung',
    'og:title',
    'a;b',
    'x.y z',
    'Why!',
    'Last edited by whom now',
    'a/b',
    'Заголовок',
    '💰 cost',
    '1. Item',
    'One two three four five six seven eight nine',
    'k'.repeat(200),
  ]
  const apply = (source: string, edit: { from: number; to: number; insert: string } | null) =>
    edit ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to) : source
  const fences = (source: string) => source.split('\n').filter((one) => one === '---').length

  test.each(NAMES)('%s', (name) => {
    if (!isPropertyName(name)) {
      expect(addProperty('# Note\n', name)).toBeNull()
      const written = `${writeFrontMatter([[name, 'x']])}\n`
      expect(frontMatterBlock(written)).not.toBeNull()
      expect(frontMatterValue(written, name)).toBe('x')
      return
    }

    let note = apply('# Note\n', addProperty('# Note\n', name))
    expect(frontMatterBlock(note), note).not.toBeNull()
    for (const value of ['x', 'What we did, and why we did it.', 'Is this it, then?']) {
      note = apply(note, writeProperty(note, name, value))
      expect(frontMatterBlock(note), note).not.toBeNull()
      expect(frontMatterValue(note, name)).toBe(value)
    }
    note = apply(note, writeProperty(note, 'status', 'open'))
    expect(fences(note), note).toBe(2)

    const second = apply('---\ntitle: x\n---\n', addProperty('---\ntitle: x\n---\n', name))
    expect(frontMatterKeys(second)).toEqual(['title', name])

    const renamed = apply(
      '---\ntitle: x\nb: 2\n---\n',
      renameProperty('---\ntitle: x\nb: 2\n---\n', 'title', name),
    )
    expect(frontMatterKeys(renamed)).toEqual([name, 'b'])

    const left = `---\ntitle: x\n${name}: 2\n---\nbody\n`
    expect(frontMatterBlock(apply(left, frontMatterEdit(left, 'title', null)))).not.toBeNull()

    const written = `${writeFrontMatter([[name, 'What we did, and why we did it.']])}\n`
    expect(frontMatterBlock(written), written).not.toBeNull()
  })
})

describe('reading the front matter', () => {
  test('the block, and nothing where a note has none', () => {
    expect(frontMatter('---\ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
    expect(frontMatter('No front matter')).toBeNull()
    expect(frontMatter('# Title\n\n---\n\nmore')).toBeNull()
  })

  test('a closing fence is a line that says nothing else', () => {
    expect(frontMatter('---\ntitle: Hi\n----\n\nBody')).toBeNull()
    expect(frontMatter('---\ntitle: Hi\n--- and more\n\nBody')).toBeNull()
  })

  test('an opening fence stands at the left margin', () => {
    expect(frontMatter('  ---\ntitle: Hi\n---\n\nBody')).toBeNull()
    expect(frontMatter('\t---\ntitle: Hi\n---\n\nBody')).toBeNull()
    expect(frontMatter('---  \ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
  })

  test('a byte order mark in front of the fence', () => {
    const source = '\uFEFF---\ntitle: a\n---\nbody\n'
    expect(frontMatterValue(source, 'title')).toBe('a')
    expect(stripFrontMatter(source)).toBe('body\n')

    expect(frontMatterEdit(source, 'title', 'b')).toEqual({ from: 11, to: 13, insert: ' b' })
    expect(frontMatterEdit(source, 'title', null)).toEqual({ from: 1, to: 18, insert: '' })
  })

  test('the note without it, which is what a renderer reads', () => {
    expect(stripFrontMatter('---\ntitle: Hi\n---\n# Title')).toBe('# Title')
    expect(stripFrontMatter('# Title')).toBe('# Title')
  })

  test('one key, quotes off, and never a key indented under another', () => {
    const source = '---\ntitle: "Field Notes"\nauthor: Ada\nexport:\n  paper: A5\n---\n\nBody'

    expect(frontMatterValue(source, 'title')).toBe('Field Notes')
    expect(frontMatterValue(source, 'author')).toBe('Ada')
    expect(frontMatterValue(source, 'paper')).toBeNull()
    expect(frontMatterValue(source, 'missing')).toBeNull()
  })

  test('a key with nothing after it says nothing', () => {
    expect(frontMatterValue('---\nicon:\n---\n', 'icon')).toBeNull()
  })

  test('a comment after the value', () => {
    expect(frontMatterValue('---\ntitle: a # note\n---\n', 'title')).toBe('a')
    expect(frontMatterValue("---\ntitle: 'a # b' # note\n---\n", 'title')).toBe('a # b')
    expect(frontMatterValue('---\ntitle: a#b\n---\n', 'title')).toBe('a#b')
    expect(frontMatterValue('---\nicon: # none yet\n---\n', 'icon')).toBeNull()
    expect(frontMatterList('---\ntags: [a, "b #c"] # mine\n---\n', 'tags')).toEqual(['a', 'b #c'])

    const source = '---\ntitle: a # note\n---\n'
    const edit = frontMatterEdit(source, 'title', 'b')
    expect(edit && source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe(
      '---\ntitle: b # note\n---\n',
    )
  })
})

describe('the keys a block holds', () => {
  test('are its top-level ones, as written, and none where there is no block', () => {
    expect(
      frontMatterKeys(
        '---\ntitle: Trip\naliases:\n  - One\n# a note\nDue date: soon\n---\nWords: no\n',
      ),
    ).toEqual(['title', 'aliases', 'Due date'])
    expect(frontMatterKeys('Words: no\n')).toEqual([])
  })
})

describe('reading a key as a list', () => {
  const front = (body: string) => `---\n${body}\n---\n\nWords.\n`

  test('reads a flow sequence', () => {
    expect(frontMatterList(front('aliases: [One, Two]'), 'aliases')).toEqual(['One', 'Two'])
  })

  test('reads the lines written under the key', () => {
    expect(frontMatterList(front('aliases:\n  - One\n  - Two'), 'aliases')).toEqual(['One', 'Two'])
    expect(frontMatterList(front('aliases:\n- One\n- Two'), 'aliases')).toEqual(['One', 'Two'])
  })

  test('reads a single value as a list of one', () => {
    expect(frontMatterList(front('aliases: One'), 'aliases')).toEqual(['One'])
  })

  test('takes the quotes off, whichever they are', () => {
    expect(frontMatterList(front('aliases: ["One", \'Two\']'), 'aliases')).toEqual(['One', 'Two'])
    expect(frontMatterList(front('aliases:\n  - "One two"'), 'aliases')).toEqual(['One two'])
  })

  test('stops at the next key of the note’s own', () => {
    const body = 'aliases:\n  - One\ntitle: Not an alias\n'
    expect(frontMatterList(front(body), 'aliases')).toEqual(['One'])
  })

  test('is nothing where there is nothing to read', () => {
    expect(frontMatterList('Words.\n', 'aliases')).toEqual([])
    expect(frontMatterList(front('title: A note'), 'aliases')).toEqual([])
    expect(frontMatterList(front('aliases:'), 'aliases')).toEqual([])
    expect(frontMatterList(front('aliases: []'), 'aliases')).toEqual([])
  })

  test('is not read from a key indented under another', () => {
    expect(frontMatterList(front('export:\n  aliases: [One]'), 'aliases')).toEqual([])
  })
})

describe('setting a key', () => {
  const applied = (source: string, key: string, value: string | null) => {
    const edit = frontMatterEdit(source, key, value)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('opens a block on a note that has none', () => {
    expect(applied('# Plan\n\nwords\n', 'icon', 'rocket')).toBe(
      '---\nicon: rocket\n---\n# Plan\n\nwords\n',
    )
  })

  test('and on an empty note', () => {
    expect(applied('', 'icon', 'rocket')).toBe('---\nicon: rocket\n---\n')
  })

  test('goes in as the last line of a block that has other keys', () => {
    expect(applied('---\ntitle: Plan\ntags: [work]\n---\n\nwords', 'icon', 'rocket')).toBe(
      '---\ntitle: Plan\ntags: [work]\nicon: rocket\n---\n\nwords',
    )
  })

  test('replaces the value and leaves every other line alone', () => {
    expect(applied('---\nicon: rocket\ntitle: Plan\n---\nwords', 'icon', 'anchor')).toBe(
      '---\nicon: anchor\ntitle: Plan\n---\nwords',
    )
  })

  test('a key already saying it is not written again', () => {
    expect(frontMatterEdit('---\nicon: rocket\n---\n', 'icon', 'rocket')).toBeNull()
    expect(frontMatterEdit('---\nicon: "rocket"\n---\n', 'icon', 'rocket')).toBeNull()
    expect(frontMatterEdit("---\nstatus: 'yes'\n---\n", 'status', "'yes'")).toBeNull()
    expect(frontMatterEdit('---\nstatus: "yes"\n---\n', 'status', "'yes'")).toBeNull()
    expect(frontMatterEdit('---\nstatus: yes\n---\n', 'status', "'yes'")).not.toBeNull()
    expect(frontMatterEdit('---\ndone: "true"\n---\n', 'done', 'true')).not.toBeNull()
    expect(frontMatterEdit("---\ncount: '3'\n---\n", 'count', '3')).not.toBeNull()
  })

  test('keeps the line endings the file was written with', () => {
    expect(applied('---\r\ntitle: Plan\r\n---\r\nwords', 'icon', 'rocket')).toBe(
      '---\r\ntitle: Plan\r\nicon: rocket\r\n---\r\nwords',
    )
    expect(applied('# Plan\r\n', 'icon', 'rocket')).toBe('---\r\nicon: rocket\r\n---\r\n# Plan\r\n')
    expect(applied('---\r\ntitle: a\r\ntags: [x]\r\n---\r\nbody\r\n', 'title', 'b')).toBe(
      '---\r\ntitle: b\r\ntags: [x]\r\n---\r\nbody\r\n',
    )
    expect(applied('---\r\ntags:\r\n  - x\r\ntitle: a\r\n---\r\n', 'tags', 'z')).toBe(
      '---\r\ntags: z\r\ntitle: a\r\n---\r\n',
    )
  })

  test('finds a key that is not a word of letters, and edits it where it is', () => {
    const twice = applied(applied('---\n日期: a\n---\nbody\n', '日期', 'b'), '日期', 'c')
    expect(twice).toBe('---\n日期: c\n---\nbody\n')
    expect(frontMatterValue(twice, '日期')).toBe('c')
    for (const key of ['due date', 'Größe', '1st', 'a.b']) {
      expect(applied(`---\n${key}: a\n# note\n---\n`, key, 'b')).toBe(
        `---\n${key}: b\n# note\n---\n`,
      )
      expect(applied(`---\n${key}: a\n# note\nz: 1\n---\n`, key, null)).toBe(
        '---\n# note\nz: 1\n---\n',
      )
    }
  })

  test('a list written under the key goes with the value it is replaced by', () => {
    expect(applied('---\ntitle: a\ntags:\n  - x\n  - y\n---\nbody\n', 'tags', 'z')).toBe(
      '---\ntitle: a\ntags: z\n---\nbody\n',
    )
  })
})

describe('taking a key away', () => {
  const applied = (source: string, key: string) => {
    const edit = frontMatterEdit(source, key, null)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('takes its line, and nothing else in the block', () => {
    expect(applied('---\ntitle: Plan\nicon: rocket\ntags: [work]\n---\nwords', 'icon')).toBe(
      '---\ntitle: Plan\ntags: [work]\n---\nwords',
    )
  })

  test('a block that held nothing else goes with it, blank lines and all', () => {
    expect(applied('---\nicon: rocket\n---\n\n# Plan\n', 'icon')).toBe('# Plan\n')
    expect(applied('---\nicon: rocket\n---\n', 'icon')).toBe('')
  })

  test('a note that never said it is left exactly as it was', () => {
    expect(frontMatterEdit('---\ntitle: Plan\n---\nwords', 'icon', null)).toBeNull()
    expect(frontMatterEdit('# Plan\n', 'icon', null)).toBeNull()
  })

  test('the same on a file written with the other line ending', () => {
    expect(applied('---\r\nicon: rocket\r\ntitle: Plan\r\n---\r\nwords', 'icon')).toBe(
      '---\r\ntitle: Plan\r\n---\r\nwords',
    )
    expect(applied('---\r\nicon: rocket\r\n---\r\n\r\n# Plan\r\n', 'icon')).toBe('# Plan\r\n')
  })

  test('takes the list written under it too, and leaves the next key its own', () => {
    expect(applied('---\ntitle: a\ntags:\n  - x\n  - y\n---\nbody\n', 'tags')).toBe(
      '---\ntitle: a\n---\nbody\n',
    )
    expect(applied('---\ntags:\n- x\n- y\ntitle: a\n---\nbody\n', 'tags')).toBe(
      '---\ntitle: a\n---\nbody\n',
    )
  })

  test('takes a value of paragraphs whole, blank lines and all', () => {
    const source = '---\nsummary: short\nnotes: |\n  first\n\n  second\nstatus: done\n---\nbody'
    expect(applied(source, 'notes')).toBe('---\nsummary: short\nstatus: done\n---\nbody')

    const edit = frontMatterEdit(source, 'notes', 'x')
    expect(edit && source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe(
      '---\nsummary: short\nnotes: x\nstatus: done\n---\nbody',
    )
  })

  test('and stops at a blank line the next key follows', () => {
    expect(applied('---\nnotes: |\n  first\n\nstatus: done\n---\nbody', 'notes')).toBe(
      '---\n\nstatus: done\n---\nbody',
    )
  })
})

describe('setting several keys at once', () => {
  const applied = (source: string, keys: readonly (readonly [string, string | null])[]) => {
    const edit = frontMatterEdits(source, keys)
    return edit === null ? source : source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('opens a block and writes both lines', () => {
    expect(
      applied('# Plan\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBe('---\nicon: rocket\nicon-color: violet\n---\n# Plan\n')
  })

  test('joins a block that was there, leaving its own keys alone', () => {
    expect(
      applied('---\ntitle: Plan\n---\n\nwords\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBe('---\ntitle: Plan\nicon: rocket\nicon-color: violet\n---\n\nwords\n')
  })

  test('replaces one and adds the other', () => {
    expect(
      applied('---\nicon: rocket\n---\nwords\n', [
        ['icon', 'anchor'],
        ['icon-color', 'teal'],
      ]),
    ).toBe('---\nicon: anchor\nicon-color: teal\n---\nwords\n')
  })

  test('takes both away, and the block with them where it held nothing else', () => {
    expect(
      applied('---\nicon: rocket\nicon-color: violet\n---\n\n# Plan\n', [
        ['icon', null],
        ['icon-color', null],
      ]),
    ).toBe('# Plan\n')
  })

  test('is one edit however many keys moved', () => {
    const edit = frontMatterEdits('---\ntitle: Plan\n---\nwords\n', [
      ['icon', 'rocket'],
      ['icon-color', 'violet'],
    ])

    expect(edit).not.toBeNull()
    expect(edit?.to).toBeLessThan('---\ntitle: Plan\n---\n'.length)
  })

  test('and no edit at all where the note already says all of it', () => {
    expect(
      frontMatterEdits('---\nicon: rocket\nicon-color: violet\n---\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBeNull()
    expect(frontMatterEdits('# Plan\n', [['icon', null]])).toBeNull()
  })
})

describe('writing a block', () => {
  test('is the rows asked for, fenced, and nothing after the fence', () => {
    expect(
      writeFrontMatter([
        ['date', '2026-01-02'],
        ['tags', ['work', 'a/b']],
      ]),
    ).toBe('---\ndate: 2026-01-02\ntags: [work, a/b]\n---')
  })

  test('a number and a yes-or-no are written as YAML has them, a string as words', () => {
    expect(
      writeFrontMatter([
        ['pages', 412],
        ['read', true],
        ['code', '412'],
      ]),
    ).toBe("---\npages: 412\nread: true\ncode: '412'\n---")
  })

  test('a block with no rows is no block at all', () => {
    expect(writeFrontMatter([])).toBe('')
  })

  test('an empty list is still stated, because the caller asked for the row', () => {
    expect(writeFrontMatter([['tags', []]])).toBe('---\ntags: []\n---')
  })

  test('and what is written is read back as what was given', () => {
    const rows = [
      ['source', 'https://site.example/a?b=1#c'],
      ['title', "It's: here"],
      ['tags', ['work', 'two words']],
    ] as const
    const note = `${writeFrontMatter(rows)}\n\n# One\n`

    expect(frontMatterValue(note, 'source')).toBe('https://site.example/a?b=1#c')
    expect(frontMatterValue(note, 'title')).toBe("It's: here")
    expect(frontMatterList(note, 'tags')).toEqual(['work', 'two words'])
    expect(stripFrontMatter(note)).toBe('\n# One\n')
  })

  test('cannot be ended early by a value with lines in it', () => {
    const block = writeFrontMatter([['title', 'Fine\n---\n\n<img src=x>']])

    expect(block).toBe('---\ntitle: Fine --- <img src=x>\n---')
  })
})

describe('a value across lines', () => {
  const apply = (source: string, key: string, value: string | null) => {
    const edit = frontMatterEdit(source, key, value)
    return edit ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to) : source
  }

  test('a flow list broken over lines is the list', () => {
    const note = '---\ntags: [\n  work,\n  "b, c",\n]\nz: 1\n---\nrest\n'
    expect(frontMatterList(note, 'tags')).toEqual(['work', 'b, c'])
    expect(frontMatterList(note, 'z')).toEqual(['1'])
    expect(frontMatterList('---\ntags: [ # mine\n  a, # one\n  b\n]\n---\n', 'tags')).toEqual([
      'a',
      'b',
    ])
  })

  test('setting or taking away a value takes all its lines', () => {
    const list = '---\ntags: [\n  a,\n  b,\n]\nz: 1\n---\nrest\n'
    expect(apply(list, 'tags', '[c]')).toBe('---\ntags: [c]\nz: 1\n---\nrest\n')
    expect(apply(list, 'tags', null)).toBe('---\nz: 1\n---\nrest\n')
    const quote = '---\ntitle: "a\nb"\nz: 1\n---\nrest\n'
    expect(apply(quote, 'title', 'c')).toBe('---\ntitle: c\nz: 1\n---\nrest\n')
    expect(apply(quote, 'title', null)).toBe('---\nz: 1\n---\nrest\n')
    const crlf = '---\r\ntags: [\r\n  a,\r\n]\r\nz: 1\r\n---\r\nrest\r\n'
    expect(apply(crlf, 'tags', '[c]')).toBe('---\r\ntags: [c]\r\nz: 1\r\n---\r\nrest\r\n')
    expect(apply(crlf, 'tags', null)).toBe('---\r\nz: 1\r\n---\r\nrest\r\n')
  })

  test('a line a value holds open is not a key of the block', () => {
    const note = '---\ntitle: "a\nz: b"\nz: 1\n---\nrest\n'
    expect(apply(note, 'z', '2')).toBe('---\ntitle: "a\nz: b"\nz: 2\n---\nrest\n')
  })

  test('what only looks open is the one line it is', () => {
    const cases: [string, string, string][] = [
      ['---\ntitle: [draft\nz: 1\n---\nrest\n', 'title', '---\ntitle: new\nz: 1\n---\nrest\n'],
      ['---\ntitle: "Foo\nz: 1\n---\nrest\n', 'title', '---\ntitle: new\nz: 1\n---\nrest\n'],
      ["---\nnote: it's\nz: 1\n---\nrest\n", 'note', '---\nnote: new\nz: 1\n---\nrest\n'],
      ['---\na: [1, 2]\nz: 1\n---\nrest\n', 'a', '---\na: new\nz: 1\n---\nrest\n'],
      ["---\na: 'x'\nb: 'y'\n---\nrest\n", 'a', "---\na: new\nb: 'y'\n---\nrest\n"],
      ['---\na: "x" and more\nb: "y"\n---\nrest\n', 'a', '---\na: new\nb: "y"\n---\nrest\n'],
      ['---\na: [b] # [c\nz: 1\n---\nrest\n', 'a', '---\na: new # [c\nz: 1\n---\nrest\n'],
      ['---\na: |\n  [x\nz: 1\n---\nrest\n', 'a', '---\na: new\nz: 1\n---\nrest\n'],
      ['---\na:\n  - [x]\n  - y\nz: 1\n---\nrest\n', 'a', '---\na: new\nz: 1\n---\nrest\n'],
      ['---\na: x\n  y\nz: 1\n---\nrest\n', 'a', '---\na: new\nz: 1\n---\nrest\n'],
    ]
    for (const [note, key, after] of cases) {
      expect(frontMatterBlock(note)).not.toBeNull()
      expect(apply(note, key, 'new')).toBe(after)
    }
    expect(frontMatterList('---\ntags: [draft\nz: 1\n---\n', 'tags')).toEqual(['[draft'])
    expect(frontMatterList('---\ntags: [a, b]\nz: 1\n---\n', 'tags')).toEqual(['a', 'b'])
    expect(frontMatterList('---\ntags: "a"\nz: "b"\n---\n', 'tags')).toEqual(['a'])
  })

  test('taking away a key leaves a block or nothing, never its lines on the page', () => {
    expect(apply('---\ntitle: x\n---\nrest\n', 'title', null)).toBe('rest\n')
    expect(apply('---\ntitle: x\nz: 1\n---\nrest\n', 'title', null)).toBe('---\nz: 1\n---\nrest\n')
    expect(apply('---\nz: 1\ntitle: x\n---\nrest\n', 'title', null)).toBe('---\nz: 1\n---\nrest\n')
    expect(apply('---\ntitle: x\n# about\nz: 1\n---\nrest\n', 'title', null)).toBe(
      '---\n# about\nz: 1\n---\nrest\n',
    )
    for (const [note, after] of [
      ['---\ntitle: x\n# keep me\n---\nrest\n', '---\ntitle:\n# keep me\n---\nrest\n'],
      ['---\ntitle: x\nsome words\n---\nrest\n', '---\ntitle:\nsome words\n---\nrest\n'],
      ['---\ntitle: [\n  a,\n]\n# c\n---\nrest\n', '---\ntitle:\n# c\n---\nrest\n'],
    ] as const) {
      expect(opensFrontMatter(note)).toBe(true)
      expect(apply(note, 'title', null)).toBe(after)
      expect(frontMatterValue(after, 'title')).toBeNull()
      expect(opensFrontMatter(after)).toBe(true)
      expect(frontMatterEdit(after, 'title', null)).toBeNull()
    }
  })
})
