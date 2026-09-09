import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  foldHeadings,
  type FoldLines,
  foldLines,
  folding,
  sameFolds,
  toggleFold,
  unfoldEverything,
  withFolds,
} from './fold'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function state(doc: string, cursor = 0): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        folding(),
      ],
    }),
  )
}

/** Runs a command and hands back what it did: whether it answered, and the state
 *  it dispatched. */
function ran(command: StateCommand, from: EditorState): { ok: boolean; state: EditorState } {
  let next = from
  const ok = command({
    state: from,
    dispatch: (transaction) => {
      next = transaction.state
    },
  })

  return { ok, state: next }
}

const CHAPTER = '# One\n\nfirst\n\n## Under one\n\nnested\n\n# Two\n\nsecond\n'

describe('folding what the caret is in', () => {
  test('folds the heading the caret is on, and opens it again', () => {
    const first = ran(toggleFold, state(CHAPTER, 2))
    expect(first.ok).toBe(true)
    expect(foldLines(first.state)).toEqual([[1, 7]])

    const back = ran(toggleFold, first.state)
    expect(back.ok).toBe(true)
    expect(foldLines(back.state)).toEqual([])
  })

  test('folds the section the caret is inside, from a line that owns nothing', () => {
    // The caret is in "nested", under the second heading.
    const inside = CHAPTER.indexOf('nested') + 2
    const folded = ran(toggleFold, state(CHAPTER, inside))

    expect(folded.ok).toBe(true)
    expect(foldLines(folded.state)).toEqual([[5, 7]])
  })

  test('never folds the caret out of sight: it comes up to the line that owns the fold', () => {
    const inside = CHAPTER.indexOf('nested') + 2
    const folded = ran(toggleFold, state(CHAPTER, inside))
    const head = folded.state.selection.main.head

    expect(folded.state.doc.lineAt(head).number).toBe(5)
    // On the heading line, which is the one line of the fold still on screen.
    expect(folded.state.doc.lineAt(head).text).toBe('## Under one')
  })

  test('leaves the caret where it was when the fold does not reach it', () => {
    const on = state(CHAPTER, 2)
    const folded = ran(toggleFold, on)

    expect(folded.state.selection.main.head).toBe(2)
  })

  test('folds a list item that has children', () => {
    const list = '- one\n  - deeper\n  - deeper still\n- two\n'
    const folded = ran(toggleFold, state(list, 2))

    expect(folded.ok).toBe(true)
    expect(foldLines(folded.state)).toEqual([[1, 3]])
  })

  test('folds an indented block under the line that holds it', () => {
    const indented = 'A paragraph.\n\n- item\n\n      indented code\n      more of it\n'
    const folded = ran(toggleFold, state(indented, indented.indexOf('- item') + 2))

    expect(folded.ok).toBe(true)
    expect(foldLines(folded.state).length).toBe(1)
  })

  test('answers no on a line with nothing under it', () => {
    const flat = 'just a paragraph\n'
    expect(ran(toggleFold, state(flat, 3)).ok).toBe(false)
  })
})

describe('folding everything', () => {
  test('folds the top-level sections and leaves the ones inside them alone', () => {
    const folded = ran(foldHeadings, state(CHAPTER, 0))

    expect(folded.ok).toBe(true)
    // One fold per `#` heading. The `##` inside the first is already hidden by
    // it, so folding it again would be work nobody can see.
    expect(foldLines(folded.state)).toEqual([
      [1, 7],
      [9, 11],
    ])
  })

  test('brings the caret up to the section that swallowed it', () => {
    const inside = CHAPTER.indexOf('second') + 2
    const folded = ran(foldHeadings, state(CHAPTER, inside))
    const head = folded.state.selection.main.head

    expect(folded.state.doc.lineAt(head).text).toBe('# Two')
  })

  test('leaves the lists and the callouts alone: an outline is headings', () => {
    const mixed = '# One\n\n- item\n  - deeper\n\n> [!note]\n> something\n'
    const folded = ran(foldHeadings, state(mixed, 0))

    expect(foldLines(folded.state)).toEqual([[1, 7]])
  })

  test('answers no in a note with no headings to fold', () => {
    expect(ran(foldHeadings, state('a\n\nb\n', 0)).ok).toBe(false)
  })

  test('opens all of it again, whatever was folded', () => {
    const folded = ran(foldHeadings, state(CHAPTER, 0))
    const open = ran(unfoldEverything, folded.state)

    expect(open.ok).toBe(true)
    expect(foldLines(open.state)).toEqual([])
  })

  test('answers no when there was nothing folded', () => {
    expect(ran(unfoldEverything, state(CHAPTER, 0)).ok).toBe(false)
  })
})

describe('folds written down and put back', () => {
  test('come out in document order, however they were made', () => {
    // The nested section first, then the whole of the chapter above it: a range
    // set hands its chunks back in the order they were filled, not in the order
    // of the document, and what is written down has to be the document's.
    const nested = ran(toggleFold, state(CHAPTER, CHAPTER.indexOf('nested') + 2))
    const all = ran(foldHeadings, nested.state)

    expect(foldLines(all.state)).toEqual([
      [1, 7],
      [5, 7],
      [9, 11],
    ])
  })

  test('come back even when they were written down out of order', () => {
    const jumbled: FoldLines[] = [
      [9, 11],
      [1, 7],
    ]

    expect(foldLines(withFolds(state(CHAPTER, 0), jumbled))).toEqual([
      [1, 7],
      [9, 11],
    ])
  })

  test('come back on the same note', () => {
    const folded = ran(foldHeadings, state(CHAPTER, 0))
    const written = foldLines(folded.state)

    expect(foldLines(withFolds(state(CHAPTER, 0), written))).toEqual(written)
  })

  test('are dropped where the note no longer has the lines', () => {
    const shorter = state('# One\n\nfirst\n', 0)
    expect(foldLines(withFolds(shorter, [[1, 40]]))).toEqual([])
  })

  test('are dropped where the pair says nothing', () => {
    const lines = [
      [0, 3],
      [4, 4],
      [6, 2],
    ] as unknown as FoldLines[]

    expect(foldLines(withFolds(state(CHAPTER, 0), lines))).toEqual([])
  })

  test('never come back over the caret', () => {
    // The caret is in the first section, which the written-down fold covers.
    const inside = CHAPTER.indexOf('first') + 2
    expect(foldLines(withFolds(state(CHAPTER, inside), [[1, 7]]))).toEqual([])
  })

  test('a note with nothing folded is the state itself', () => {
    const plain = state(CHAPTER, 0)
    expect(withFolds(plain, [])).toBe(plain)
  })
})

describe('two sets of folds', () => {
  test('are the same when they say the same thing', () => {
    expect(
      sameFolds(
        [
          [1, 4],
          [6, 9],
        ],
        [
          [1, 4],
          [6, 9],
        ],
      ),
    ).toBe(true)
  })

  test('nothing and an empty list say the same thing', () => {
    expect(sameFolds(undefined, [])).toBe(true)
  })

  test('differ on a line, a count or an order', () => {
    expect(sameFolds([[1, 4]], [[1, 5]])).toBe(false)
    expect(sameFolds([[1, 4]], [])).toBe(false)
    expect(
      sameFolds(
        [
          [1, 4],
          [6, 9],
        ],
        [
          [6, 9],
          [1, 4],
        ],
      ),
    ).toBe(false)
  })
})
