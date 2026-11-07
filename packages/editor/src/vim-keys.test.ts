// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { loadVim } from './vim'
import { modalEditing, takeBackNibKeys } from './vim-mode'

beforeAll(async () => {
  await loadVim()
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function viewOf(doc: string, at: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage }), modalEditing(true)],
    }),
    parent: document.body,
  })
  open.push(view)
  return view
}

function press(view: EditorView, key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

describe("Vim's own keys that stand for others", () => {
  test('still find what they stand for once the app has taken its keys back', () => {
    takeBackNibKeys()
    const view = viewOf('one two', 0)
    const cm = getCM(view)
    if (!cm) throw new Error('no Vim in the view')

    expect(Vim.handleKey(cm, '<Space>', 'user')).toBe(true)
    expect(view.state.selection.main.head).toBe(1)

    expect(Vim.handleKey(cm, 's', 'user')).toBe(true)
    expect(cm.state.vim?.insertMode).toBe(true)
    expect(view.state.doc.toString()).toBe('oe two')
  })

  test("Enter on a line that is not a task is still Vim's, and splits nothing", () => {
    const view = viewOf('- one\n- two', 3)
    press(view, 'Enter')
    expect(view.state.doc.toString()).toBe('- one\n- two')
  })
})

describe('Enter on a task in normal mode', () => {
  test('ticks it, and again clears it', () => {
    const view = viewOf('- [ ] wash up\n- [ ] dry', 8)
    press(view, 'Enter')
    expect(view.state.doc.toString()).toBe('- [x] wash up\n- [ ] dry')
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1)

    press(view, 'Enter')
    expect(view.state.doc.toString()).toBe('- [ ] wash up\n- [ ] dry')
  })

  test('is a new line in insert mode, and the task is left alone', () => {
    const view = viewOf('- [ ] wash up', 13)
    const cm = getCM(view)
    if (!cm) throw new Error('no Vim in the view')
    Vim.handleKey(cm, 'i', 'user')
    expect(cm.state.vim?.insertMode).toBe(true)

    press(view, 'Enter')
    expect(view.state.doc.toString()).not.toContain('[x]')
  })

  test("after a count is the count's: nothing is ticked", () => {
    const view = viewOf('- [ ] one\n- [ ] two\n- [ ] three', 2)
    press(view, '2')
    press(view, 'Enter')
    expect(view.state.doc.toString()).not.toContain('[x]')
  })
})

describe('a pattern that backtracks without end', () => {
  test('is refused by a substitution rather than hang the page, and one that runs in time is not', () => {
    const run = `${'a'.repeat(27)}!`
    const view = viewOf(run, 0)
    const cm = getCM(view) as Parameters<typeof Vim.handleEx>[0] | null
    if (!cm) throw new Error('no Vim in the view')

    const started = Date.now()
    Vim.handleEx(cm, 's/(a+)+b/x/')
    expect(Date.now() - started).toBeLessThan(1500)
    expect(view.state.doc.toString()).toBe(run)

    Vim.handleEx(cm, 's/a+!/x/')
    expect(view.state.doc.toString()).toBe('x')
  })
})
