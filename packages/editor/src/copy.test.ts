import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { copiedFlavours } from './copy'

function state(doc: string, from: number, to: number, readOnly = false) {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    ...(readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
  })
}

describe('what a copy leaves on the clipboard', () => {
  test('the markdown as it was written', () => {
    expect(copiedFlavours(state('a **bold** word', 0, 15))?.text).toBe('a **bold** word')
  })

  test('and the same words as HTML, for whatever reads that instead', () => {
    expect(copiedFlavours(state('a **bold** word', 0, 15))?.html).toContain('<strong>bold</strong>')
  })

  test('a heading and a list arrive as a heading and a list', () => {
    const html = copiedFlavours(state('# Head\n\n- one\n- two', 0, 19))?.html ?? ''

    expect(html).toContain('<h1')
    expect(html).toContain('<li>one</li>')
  })

  test('part of a line is that part, not the line', () => {
    const flavours = copiedFlavours(state('one two three', 4, 7))
    expect(flavours?.text).toBe('two')
    expect(flavours?.html).toContain('two')
  })

  /** A comment is hidden wherever a note is read, and a copy into a word processor
   *  is a note being read; see comments.ts in @nib/markdown. */
  test('a comment is in the markdown and not in the HTML', () => {
    const doc = 'words <!-- to myself --> more'
    const flavours = copiedFlavours(state(doc, 0, doc.length))

    expect(flavours?.text).toContain('to myself')
    expect(flavours?.html).not.toContain('to myself')
  })
})

describe('when CodeMirror’s own copy is the better one', () => {
  /** It copies the caret's line and remembers that it did, so that a paste puts
   *  the line back as a line. Nothing here improves on that. */
  test('nothing is selected', () => {
    expect(copiedFlavours(state('words', 3, 3))).toBeNull()
  })

  test('several places are selected at once, which it joins line by line', () => {
    const many = EditorState.create({
      doc: 'one\ntwo\nthree',
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
      // Said out loud, because a state keeps only the first range without it.
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })

    expect(copiedFlavours(many)).toBeNull()
  })

  test('a cut out of a note nothing may be written into', () => {
    expect(copiedFlavours(state('one two', 0, 3, true), true)).toBeNull()
    // A copy out of the same note is fine: it takes nothing away.
    expect(copiedFlavours(state('one two', 0, 3, true))?.text).toBe('one')
  })
})
