import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { previewNoteOf } from './hover'

/** What the card over a `[[link]]` hands the app to write in.
 *
 *  The bug this pins: the card was an editor whatever the note it was opened over
 *  allowed, so in a note that could only be read the card under it could still be
 *  typed in, and the app had no way to know it should not have been. */
describe('the note a card hands over', () => {
  const NOTE = '# Top\n\nWords.\n\n## Part\n\nMore.\n'

  test('says the note it was opened over may not be written', () => {
    const read = EditorState.create({ extensions: [EditorState.readOnly.of(true)] })
    expect(previewNoteOf(read, 'Linked.md', NOTE, NOTE).readOnly).toBe(true)
  })

  test('and may be, where that note may be', () => {
    const written = EditorState.create({})
    const note = previewNoteOf(written, 'Linked.md', NOTE, '## Part\n\nMore.\n')

    expect(note).toEqual({
      path: 'Linked.md',
      text: NOTE,
      at: NOTE.indexOf('## Part'),
      readOnly: false,
    })
  })
})
