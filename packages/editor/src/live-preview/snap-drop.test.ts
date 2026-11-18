import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import { dropSpacing } from './snap'

function stateOf(doc: string, dragged: string): EditorState {
  const from = doc.indexOf(dragged)
  return parsed(
    EditorState.create({
      doc,
      selection:
        from < 0 ? EditorSelection.cursor(0) : EditorSelection.range(from, from + dragged.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dropSpacing,
      ],
    }),
  )
}

function moved(doc: string, word: string, at: number): string {
  const state = stateOf(doc, word)
  const from = doc.indexOf(word)
  const changes = state.changes([
    { from, to: from + word.length },
    { from: at, insert: word },
  ])
  const after = state.update({
    changes,
    selection: { anchor: changes.mapPos(at, -1), head: changes.mapPos(at, 1) },
    userEvent: 'move.drop',
  }).state
  expect(after.sliceDoc(after.selection.main.from, after.selection.main.to)).toBe(word)
  return after.doc.toString()
}

function copied(doc: string, text: string, at: number): string {
  const state = stateOf(doc, '\u0000')
  return state
    .update({
      changes: { from: at, insert: text },
      selection: { anchor: at, head: at + text.length },
      userEvent: 'input.drop',
    })
    .state.doc.toString()
}

describe('a word dragged between words', () => {
  test.each([
    [
      'alpha beta gamma\n\nlast line here\n',
      'alpha gamma\n\nlast line beta here\n',
      'beta',
      'alpha beta gamma\n\nlast line here\n'.indexOf(' here'),
    ],
    [
      'alpha beta gamma\n\nlast line here\n',
      'beta gamma\n\nalpha last line here\n',
      'alpha',
      'alpha beta gamma\n\nlast line here\n'.indexOf('last'),
    ],
    [
      'alpha beta gamma\n\nlast line here\n',
      'alpha beta gamma\n\nlast line here\n',
      'gamma',
      'alpha beta gamma\n\nlast line here\n'.indexOf('\n\nlast'),
    ],
    [
      'alpha beta gamma\n\nlast line here\n',
      'here alpha beta gamma\n\nlast line\n',
      'here',
      'alpha beta gamma\n\nlast line here\n'.indexOf('alpha'),
    ],
    [
      '- one **two** three four\n',
      '- one **two** four three\n',
      'four',
      '- one **two** three four\n'.indexOf('** three'),
    ],
    [
      '- one **two** three four\n',
      '- one **two** three four\n',
      'one',
      '- one **two** three four\n'.indexOf('two'),
    ],
    ['a **two** b\n', 'a b **two**\n', 'b', 'a **'.length],
  ])('%j', (input, wanted, extra, last) => expect(moved(input, extra, last)).toBe(wanted))

  test.each([
    ['abcdef\n', 'abcxdef\n', 'x', 3],
    ['one, two\n', 'one x, two\n', 'x', 3],
    ['日本語\n', '日字本語\n', '字', 1],
  ])('%j', (input, wanted, extra, last) => expect(copied(input, extra, last)).toEqual(wanted))
})
