import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from '../markdown/extensions'
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
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
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
  test('takes a space with it and leaves one behind', () => {
    const doc = 'alpha beta gamma\n\nlast line here\n'
    expect(moved(doc, 'beta', doc.indexOf(' here'))).toBe('alpha gamma\n\nlast line beta here\n')
    expect(moved(doc, 'alpha', doc.indexOf('last'))).toBe('beta gamma\n\nalpha last line here\n')
    expect(moved(doc, 'gamma', doc.indexOf('\n\nlast'))).toBe(doc)
    expect(moved(doc, 'here', doc.indexOf('alpha'))).toBe('here alpha beta gamma\n\nlast line\n')
  })

  test('lands outside the hidden marks of the bold it was dropped beside', () => {
    const doc = '- one **two** three four\n'
    expect(moved(doc, 'four', doc.indexOf('** three'))).toBe('- one **two** four three\n')
    expect(moved(doc, 'one', doc.indexOf('two'))).toBe('- one **two** three four\n')
    expect(moved('a **two** b\n', 'b', 'a **'.length)).toBe('a b **two**\n')
  })

  test('takes no space in the middle of a word or between characters that take none', () => {
    expect(copied('abcdef\n', 'x', 3)).toBe('abcxdef\n')
    expect(copied('one, two\n', 'x', 3)).toBe('one x, two\n')
    expect(copied('日本語\n', '字', 1)).toBe('日字本語\n')
  })
})
