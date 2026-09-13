import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { completionExtensions, loadCompletion } from './completion'
import { nibMarkdownExtensions } from './markdown/extensions'
import { modeExtensions } from './modes'
import { parsed } from '../test/parsed'

// The library's own `closeBrackets` is what wraps a selection in a bracket, and it is
// fetched rather than carried now: an editor on screen has it a frame after it is
// built, and a state built here has it once this has resolved. See completion.ts.
beforeAll(async () => {
  await loadCompletion()
})

/** Types one character the way the editor does: every input handler in turn,
 *  and the plain insertion when nobody claimed it. All of the modes are on, so
 *  the marks are tested beside closeBrackets rather than on their own. */
function type(
  doc: string,
  selection: { anchor: number; head: number },
  character: string,
): EditorState {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(selection.anchor, selection.head),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        modeExtensions(),
        completionExtensions(),
      ],
    }),
  )

  const view = {
    get state() {
      return state
    },
    compositionStarted: false,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView

  const { from, to } = state.selection.main
  for (const handler of state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, character, () => state.update({}))) return state
  }

  // What CodeMirror itself does with a character nothing claimed.
  return state.update({
    changes: { from, to, insert: character },
    selection: EditorSelection.cursor(from + character.length),
  }).state
}

/** The document with the selection written into it as `|`, or `«…»` when it
 *  covers something, so a test reads the way the screen looks. */
function shown(state: EditorState): string {
  const { from, to } = state.selection.main
  const text = state.doc.toString()
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`
}

/** Typing a character over `word`, wherever it is in the document. */
function typeOver(doc: string, word: string, character: string): string {
  const at = doc.indexOf(word)
  return shown(type(doc, { anchor: at, head: at + word.length }, character))
}

const MARKS = ['`', '*', '_', '~', '=']

/** The marks that have a doubled meaning in markdown, and what it is. */
const DOUBLING = [
  ['*', 'strong'],
  ['_', 'strong'],
  ['~', 'a strikethrough'],
  ['=', 'a highlight'],
] as const

describe('a mark typed over a selection', () => {
  for (const mark of MARKS) {
    test(`${mark} wraps the selection and keeps it`, () => {
      expect(typeOver('one two three', 'two', mark)).toBe(`one ${mark}«two»${mark} three`)
    })

    test(`${mark} with nothing selected types as itself`, () => {
      expect(shown(type('one two', { anchor: 3, head: 3 }, mark))).toBe(`one${mark}| two`)
    })
  }

  for (const [mark, meaning] of DOUBLING) {
    test(`${mark} typed again doubles into ${meaning}`, () => {
      const once = `a ${mark}word${mark} b`
      expect(typeOver(once, 'word', mark)).toBe(`a ${mark}${mark}«word»${mark}${mark} b`)
    })
  }

  test('the selection keeps the way it points', () => {
    const after = type('one two', { anchor: 7, head: 4 }, '*')
    expect(after.doc.toString()).toBe('one *two*')
    expect(after.selection.main.anchor).toBe(8)
    expect(after.selection.main.head).toBe(5)
  })

  test('a bracket still wraps, which is where the idea comes from', () => {
    expect(typeOver('one two three', 'two', '(')).toBe('one («two») three')
  })

  test('a character that is not a mark replaces the selection', () => {
    expect(typeOver('one two three', 'two', 'x')).toBe('one x| three')
  })
})

describe('in code a mark is a character', () => {
  test('inside an inline span', () => {
    expect(typeOver('run `one two` now', 'one', '*')).toBe('run `*| two` now')
  })

  // Which is also what a second backtick does to the span the first one made:
  // by then the words are code, and in code a backtick is a backtick.
  test('a backtick does not double into a longer span', () => {
    expect(typeOver('a `word` b', 'word', '`')).toBe('a ``|` b')
  })

  for (const mark of MARKS) {
    test(`${mark} inside a fence`, () => {
      const doc = ['```', 'one two', '```'].join('\n')
      expect(typeOver(doc, 'two', mark)).toBe(['```', `one ${mark}|`, '```'].join('\n'))
    })
  }

  test('a selection that starts in prose and ends in a fence types plainly', () => {
    const doc = ['text', '', '```', 'code', '```'].join('\n')
    const at = doc.indexOf('code')
    expect(shown(type(doc, { anchor: 0, head: at + 2 }, '*'))).toBe('*|de\n```')
  })
})
