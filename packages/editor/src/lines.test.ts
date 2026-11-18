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

const META = '---\nicon: list-checks\n---\n'

describe('sorting and reversing lines', () => {
  test.each([
    [sortLines, '«apple\nfig\npear»', '«pear\napple\nfig»'],
    [
      sortLines,
      'Shopping\n\n«- apple\n- fig\n- pear»\n\nAfter',
      'Shopping\n\n- pear|\n- apple\n- fig\n\nAfter',
    ],
    [
      sortLines,
      '«- item 1\n- [ ] Item 2\n- [x] item 10»',
      '«- [x] item 10\n- [ ] Item 2\n- item 1»',
    ],
    [sortLines, '«a\nb»\nc', '«b\na\n»c'],
    [reverseLines, '«three\ntwo\none»', '«one\ntwo\nthree»'],
  ])('%j', (input, wanted, extra) => expect(note(input, extra)).toEqual(wanted))

  test('gives way on a line with nothing to sort it against', () => {
    expect(run(sortLines, 'alone|').took).toBe(false)
  })

  test('stops at the front matter rather than sorting its fences in', () => {
    expect(note(sortLines, `${META}b|\na`)).toBe(`${META}«a\nb»`)
  })
})

describe('joining lines', () => {
  test.each([
    [joinLines, 'one| two', 'one|\n   two'],
    [joinLines, '- one| two', '- one|\n- [ ] two'],
    [joinLines, '> one| two', '> one|\n> two'],
    [joinLines, '«a b c»', '«a\nb\nc»'],
    [joinLines, 'one|\ntwo', 'one|\n\ntwo'],
    [joinLines, '|two', '|\ntwo'],
  ])('%j', (input, wanted, extra) => expect(note(input, extra)).toEqual(wanted))

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
