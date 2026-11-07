// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { Direction, EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { firstStrong, leftToRightLines, rightToLeftLines } from './modes'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, rtl = false): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        EditorView.contentAttributes.of({ dir: rtl ? 'rtl' : 'ltr' }),
        rtl ? rightToLeftLines : leftToRightLines,
      ],
    }),
    parent: document.body,
  })
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({})
  open.push(view)
  return view
}

function directions(view: EditorView): (string | null)[] {
  return [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.getAttribute('dir'))
}

describe('the way a line reads', () => {
  test('is its first strong letter, past the marks Markdown writes', () => {
    expect(firstStrong('- **مرحبا** world')).toBe(Direction.RTL)
    expect(firstStrong('# 12 שלום')).toBe(Direction.RTL)
    expect(firstStrong('> [!note] hello مرحبا')).toBe(Direction.LTR)
    expect(firstStrong('- 123 ...')).toBeNull()
  })

  test('is told to the editor wherever it differs from the note, so keys move the way the line reads', () => {
    const view = viewOf('# Title\n\nمرحبا بالعالم\n\n- عنصر\n\nplain\n\n42\n')
    expect(directions(view)).toEqual([null, null, 'rtl', null, 'rtl', null, null, null, null, null])
  })

  test('and in a right-to-left note, a line written left to right reads that way', () => {
    const view = viewOf('مرحبا\n\nhello\n\n42\n', true)
    expect(directions(view)).toEqual([null, null, 'ltr', null, null, null])
  })

  test('code, a table and front matter keep the note’s own way', () => {
    const view = viewOf('---\nعنوان: x\n---\n\n```\nمرحبا\n```\n\n| مرحبا |\n| --- |\n')
    expect(directions(view).every((one) => one === null)).toBe(true)
  })
})
