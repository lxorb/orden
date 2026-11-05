// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { folding } from './fold'
import {
  agentMarksIn,
  foldLine,
  select,
  selectionsOf,
  setAgentMarks,
  unfoldLine,
} from './agent-hands'

const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        folding(),
        EditorState.allowMultipleSelections.of(true),
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  return view
}

describe('what an agent does to an editor (#1078)', () => {
  test('selections are read and set by line and character, several at once', () => {
    const view = viewOf('one two\nthree four\n')
    select(view, [
      { anchor: { line: 1, ch: 4 }, head: { line: 1, ch: 7 } },
      { anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 5 } },
    ])
    expect(selectionsOf(view)).toEqual([
      { anchor: { line: 1, ch: 4 }, head: { line: 1, ch: 7 }, text: 'two' },
      { anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 5 }, text: 'three' },
    ])
    // A place past the note is the note's end, never an error.
    select(view, [{ anchor: { line: 99, ch: 99 }, head: { line: 99, ch: 99 } }])
    expect(selectionsOf(view)[0]?.head).toEqual({ line: 3, ch: 0 })
  })

  test('marks are an agent’s own, move with the words, and are replaced whole', () => {
    const view = viewOf('teh cat\n')
    setAgentMarks(view, 'claude', [
      {
        agent: 'claude',
        from: { line: 1, ch: 0 },
        to: { line: 1, ch: 3 },
        message: 'the?',
        severity: 'warning',
      },
    ])
    setAgentMarks(view, 'codex', [
      {
        agent: 'codex',
        from: { line: 1, ch: 4 },
        to: { line: 1, ch: 7 },
        message: 'cat',
        severity: 'info',
      },
    ])
    expect(view.dom.querySelector('.cm-agent-mark-warning')?.getAttribute('title')).toBe('the?')

    view.dispatch({ changes: { from: 0, insert: 'so ' } })
    expect(agentMarksIn(view, 'claude')).toEqual([
      {
        agent: 'claude',
        from: { line: 1, ch: 3 },
        to: { line: 1, ch: 6 },
        message: 'the?',
        severity: 'warning',
      },
    ])

    setAgentMarks(view, 'claude', [])
    expect(agentMarksIn(view, 'claude')).toEqual([])
    expect(agentMarksIn(view)).toHaveLength(1)
  })

  test('a heading’s section folds and unfolds by its line', () => {
    const view = viewOf('# One\n\nwords\n\n# Two\n')
    expect(foldLine(view, 1)).toBe(true)
    expect(unfoldLine(view, 1)).toBe(true)
    expect(unfoldLine(view, 1)).toBe(false)
    expect(foldLine(view, 3)).toBe(false)
  })
})
