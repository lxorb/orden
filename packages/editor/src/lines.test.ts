import { deleteCharBackward, deleteCharForward } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { deleteLine, insertLineAbove, joinLines, reverseLines, sortLines } from './lines'

function run(command: StateCommand, marked: string): { took: boolean; note: string } {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[|«»]/g, '')
  const selection =
    caret >= 0
      ? EditorSelection.cursor(caret)
      : EditorSelection.range(marked.indexOf('«'), marked.indexOf('»') - 1)

  let state = parsed(
    EditorState.create({
      doc,
      selection,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )

  const took = command({ state, dispatch: (transaction) => (state = transaction.state) })
  const { from, to } = state.selection.main
  const text = state.doc.toString()
  const note =
    from === to
      ? text.slice(0, from) + '|' + text.slice(from)
      : text.slice(0, from) + '«' + text.slice(from, to) + '»' + text.slice(to)

  return { took, note }
}

const note = (command: StateCommand, marked: string) => run(command, marked).note

function textAfter(command: StateCommand, doc: string, caret: number): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

const META = '---\nicon: list-checks\n---\n'

describe('sorting and reversing lines', () => {
  test('sorts the selected lines and leaves them selected', () => {
    expect(note(sortLines, '«pear\napple\nfig»')).toBe('«apple\nfig\npear»')
  })

  test('sorts the list the caret is in when nothing is selected', () => {
    expect(note(sortLines, 'Shopping\n\n- pear|\n- apple\n- fig\n\nAfter')).toBe(
      'Shopping\n\n«- apple\n- fig\n- pear»\n\nAfter',
    )
  })

  test('reads past markers and boxes, case, and counts numbers as numbers', () => {
    expect(note(sortLines, '«- [x] item 10\n- [ ] Item 2\n- item 1»')).toBe(
      '«- item 1\n- [ ] Item 2\n- [x] item 10»',
    )
  })

  test('leaves the line the selection ends in front of alone', () => {
    expect(note(sortLines, '«b\na\n»c')).toBe('«a\nb»\nc')
  })

  test('reverses the lines', () => {
    expect(note(reverseLines, '«one\ntwo\nthree»')).toBe('«three\ntwo\none»')
  })

  test('gives way on a line with nothing to sort it against', () => {
    expect(run(sortLines, 'alone|').took).toBe(false)
  })

  test('stops at the front matter rather than sorting its fences in', () => {
    expect(note(sortLines, `${META}b|\na`)).toBe(`${META}«a\nb»`)
  })
})

describe('sorting and reversing the list the caret is in', () => {
  test('sorts only the list and leaves the line that introduces it on top', () => {
    expect(note(sortLines, 'Groceries:\n- pear|\n- apple')).toBe('Groceries:\n«- apple\n- pear»')
  })

  test('sorting keeps each child under its own item', () => {
    expect(note(sortLines, '- b|\n  - x\n- a\n  - y')).toBe('«- a\n  - y\n- b\n  - x»')
  })

  test('reversing keeps each child under its own item', () => {
    expect(note(reverseLines, '- a|\n  - a1\n- b')).toBe('«- b\n- a\n  - a1»')
  })

  test('sorts the items beside the caret’s in a list inside another', () => {
    expect(note(sortLines, '- top\n  - z|\n  - y\n- after')).toBe('- top\n«  - y\n  - z»\n- after')
  })

  test('a sorted numbered list still counts up from its first number', () => {
    expect(note(sortLines, '1. pear|\n2. apple\n3. fig')).toBe('«1. apple\n2. fig\n3. pear»')
  })

  test('a loose list keeps one blank line between items', () => {
    expect(note(sortLines, '- |b\n\n- a\n\nafter')).toBe('«- a\n\n- b»\n\nafter')
  })

  test('a tight list sorts by its words', () => {
    expect(note(sortLines, '- |c\n- b\n- a')).toBe('«- a\n- b\n- c»')
  })

  test('a child moves in when its item’s number grows a digit', () => {
    const items = Array.from({ length: 10 }, (_, i) => `${i + 1}. item${i}`)
    items[0] = '1. |item0\n   - child'
    const reversed = note(reverseLines, items.join('\n')).replace(/[«»]/g, '')
    expect(reversed.slice(reversed.indexOf('10.'))).toBe('10. item0\n    - child')
  })
})

describe('sorting and reversing lines in code or a table', () => {
  const code = 'Imports:\n\n```js\nimport b|\nimport a\n```\n\nAfter'

  test('sorting in a code block keeps the fence lines in place', () => {
    expect(note(sortLines, code)).toBe('Imports:\n\n```js\n«import a\nimport b»\n```\n\nAfter')
  })

  test('reversing in a code block keeps the fence lines in place', () => {
    expect(note(reverseLines, code)).toBe('Imports:\n\n```js\n«import a\nimport b»\n```\n\nAfter')
  })

  test('sorting in code inside a list item sorts the code, not the list', () => {
    expect(note(sortLines, '- step\n  ```\n  b|\n  a\n  ```\n- next')).toBe(
      '- step\n  ```\n«  a\n  b»\n  ```\n- next',
    )
  })

  test('gives way on a fence line', () => {
    expect(run(sortLines, '```js|\nb\na\n```').took).toBe(false)
  })

  test('a line just above a fence is not sorted in with the code', () => {
    expect(run(sortLines, 'Imports:|\n```js\nb\na\n```').took).toBe(false)
  })

  const table = 'Sizes\n\n| n | x |\n| - | - |\n| 2 | b |\n| 1 | a |'

  test('sorting in a table sorts only its body rows', () => {
    expect(textAfter(sortLines, table, table.indexOf('2 | b'))).toBe(
      'Sizes\n\n| n | x |\n| - | - |\n| 1 | a |\n| 2 | b |',
    )
  })

  test('gives way on a table’s header row', () => {
    expect(textAfter(sortLines, table, table.indexOf('n | x'))).toBe(table)
  })
})

describe('joining lines', () => {
  test('pulls the next line up with one space, the caret at the seam', () => {
    expect(note(joinLines, 'one|\n   two')).toBe('one| two')
  })

  test('takes the list marker, box and quote marks off the line that comes up', () => {
    expect(note(joinLines, '- one|\n- [ ] two')).toBe('- one| two')
    expect(note(joinLines, '> one|\n> two')).toBe('> one| two')
  })

  test('joins every selected line onto the first', () => {
    expect(note(joinLines, '«a\nb\nc»')).toBe('«a b c»')
  })

  test('adds no space onto an empty line or before one', () => {
    expect(note(joinLines, 'one|\n\ntwo')).toBe('one|\ntwo')
    expect(note(joinLines, '|\ntwo')).toBe('|two')
  })

  test('gives way on the last line', () => {
    expect(run(joinLines, 'first\nlast|').took).toBe(false)
  })
})

describe('a line above', () => {
  test('opens an empty line above, indented like the caret’s', () => {
    expect(note(insertLineAbove, 'one\n  two|')).toBe('one\n  |\n  two')
  })

  test('opens it under the front matter rather than inside it', () => {
    expect(note(insertLineAbove, `${META}# Title|`)).toBe(`${META}|\n# Title`)
  })
})

describe('deleting a line', () => {
  test('deletes the caret’s line and keeps its column', () => {
    expect(note(deleteLine, 'one\ntw|o\nthree')).toBe('one\nth|ree')
  })

  test('deletes the first line that shows and leaves the front matter whole', () => {
    expect(note(deleteLine, `${META}# Tit|le\nwords`)).toBe(`${META}words|`)
  })

  test('never leaves the caret inside an emoji on the line that comes up', () => {
    expect(note(deleteLine, 'a|bc\n😀x')).toBe('|😀x')
    for (const key of [deleteCharBackward, deleteCharForward] as unknown as StateCommand[]) {
      expect(note(key, note(deleteLine, 'zz\na|bc\n😀x'))).not.toMatch(/\p{Cs}/u)
    }
  })
})
