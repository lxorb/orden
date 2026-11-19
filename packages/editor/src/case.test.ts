import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { lowerCase, titleCase, upperCase } from './case'
import { ordenMarkdownExtensions } from './markdown/extensions'

function run(command: StateCommand, doc: string, from: number, to = from) {
  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) })
  const took = command({ state, dispatch: (transaction) => (state = transaction.state) })
  const { from: start, to: end } = state.selection.main
  return { took, doc: state.doc.toString(), selected: state.sliceDoc(start, end), start, end }
}

describe('changing case', () => {
  test('upper and lower case the selection and keep it selected', () => {
    expect(run(upperCase, 'say hello there', 4, 9)).toMatchObject({
      doc: 'say HELLO there',
      selected: 'HELLO',
    })
    expect(run(lowerCase, 'SAY HELLO', 0, 9).doc).toBe('say hello')
  })

  test('title case starts every word and lowers the rest', () => {
    expect(run(titleCase, 'the QUICK brown-fox', 0, 19).doc).toBe('The Quick Brown-Fox')
  })

  test('title case keeps an apostrophe inside its word', () => {
    expect(run(titleCase, "don't stop", 0, 10).doc).toBe("Don't Stop")
  })

  test('title cases letters beyond English', () => {
    expect(run(titleCase, 'élan über', 0, 9).doc).toBe('Élan Über')
  })

  test('an empty selection means the word the caret is in, and the caret stays', () => {
    expect(run(upperCase, 'one two three', 5)).toMatchObject({ doc: 'one TWO three', start: 5 })
  })

  test('the selection follows a letter that changes length', () => {
    expect(run(upperCase, 'straße', 0, 6)).toMatchObject({ doc: 'STRASSE', selected: 'STRASSE' })
  })

  test('two carets in one word change it once, and keep their places', () => {
    let state = EditorState.create({
      doc: 'hello world',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
      extensions: EditorState.allowMultipleSelections.of(true),
    })
    upperCase({ state, dispatch: (transaction) => (state = transaction.state) })
    expect(state.doc.toString()).toBe('HELLO world')
    expect(state.selection.ranges.map((range) => range.head)).toEqual([1, 3])
  })

  test('a caret stays among its letters when one before it changes length', () => {
    expect(run(upperCase, 'ßab', 2)).toMatchObject({ doc: 'SSAB', start: 3 })
  })

  test('words already in that case are left out of the history', () => {
    let dispatched = false
    const state = EditorState.create({ doc: 'LOUD', selection: EditorSelection.range(0, 4) })
    upperCase({ state, dispatch: () => (dispatched = true) })
    expect(dispatched).toBe(false)
  })
})

function recasedNote(command: StateCommand, doc: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('changing case over a note with links and block ids in it', () => {
  test('title case changes the link text and leaves the link address alone', () => {
    expect(recasedNote(titleCase, 'see [the docs](https://example.com/api/readme) now')).toBe(
      'See [The Docs](https://example.com/api/readme) Now',
    )
  })

  test('upper case changes the picture text and leaves the picture path alone', () => {
    expect(recasedNote(upperCase, 'a cat ![cat](attachments/cat.png)')).toBe('A CAT ![CAT](attachments/cat.png)')
  })

  test('upper case leaves the block id other notes link to alone', () => {
    expect(recasedNote(upperCase, 'remember this ^intro1')).toBe('REMEMBER THIS ^intro1')
  })

  test('lower case leaves a block id written with capitals alone', () => {
    expect(recasedNote(lowerCase, 'KEEP THIS ^Plan-A')).toBe('keep this ^Plan-A')
  })

  test('upper case changes the shown words of a wikilink and leaves where it points alone', () => {
    expect(recasedNote(upperCase, 'go [[Plan#^Step-1|next step]]')).toBe('GO [[Plan#^Step-1|NEXT STEP]]')
  })
})
