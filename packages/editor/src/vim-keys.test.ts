// @vitest-environment jsdom
import { history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { loadVim } from './vim'
import { modalEditing, takeBackNibKeys } from './vim-mode'
import { GROWS_AT_MOST, measuredGrowth } from '../../../scripts/growth'

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
    const run = `${'a'.repeat(32)}!`
    const view = viewOf(run, 0)
    const cm = getCM(view) as Parameters<typeof Vim.handleEx>[0] | null
    if (!cm) throw new Error('no Vim in the view')

    Vim.handleEx(cm, 's/(a+)+b/x/')
    expect(view.state.doc.toString()).toBe(run)

    Vim.handleEx(cm, 's/a+!/x/')
    expect(view.state.doc.toString()).toBe('x')
  })
})

describe('a command over many lines', () => {
  const cmOf = (view: EditorView) => {
    const cm = getCM(view) as Parameters<typeof Vim.handleEx>[0] | null
    if (!cm) throw new Error('no Vim in the view')
    return cm
  }

  test('a substitution writes the note a few times, not once a line, and one undo takes it back', () => {
    const doc = Array.from({ length: 300 }, (_, at) => `foo ${at}`).join('\n')
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage }), modalEditing(true), history()],
      }),
      parent: document.body,
    })
    open.push(view)
    const cm = cmOf(view)
    let drawn = 0
    const update = view.update.bind(view)
    view.update = (transactions) => {
      drawn++
      update(transactions)
    }

    Vim.handleEx(cm, '%s/foo/baz/g')

    expect(view.state.doc.toString()).toBe(doc.replaceAll('foo', 'baz'))
    expect(drawn).toBeLessThan(10)
    Vim.handleKey(cm, 'u', 'user')
    expect(view.state.doc.toString()).toBe(doc)
  })

  test('a normal command over every line of prose writes the note once, in time that grows with its lines', () => {
    const run = (lines: number) => {
      const doc = Array.from({ length: lines }, (_, at) => `foo ${at}\n`).join('\n')
      const view = new EditorView({
        state: EditorState.create({
          doc,
          extensions: [markdown({ base: markdownLanguage }), modalEditing(true), history()],
        }),
        parent: document.body,
      })
      open.push(view)
      const cm = cmOf(view)
      let drawn = 0
      const update = view.update.bind(view)
      view.update = (transactions) => {
        drawn++
        update(transactions)
      }
      const started = performance.now()
      Vim.handleEx(cm, '%norm Ax')
      const took = performance.now() - started

      expect(view.state.doc.toString()).toBe(doc.replace(/\n/g, 'x\n') + 'x')
      expect(drawn).toBeLessThan(10)
      Vim.handleKey(cm, 'u', 'user')
      expect(view.state.doc.toString()).toBe(doc)
      return took
    }
    expect(measuredGrowth(run, 1000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)

  test('a global delete takes every matching line, however many', () => {
    const doc = Array.from({ length: 2000 }, (_, at) =>
      at % 2 ? `keep ${at}` : `drop ${at}`,
    ).join('\n')
    const view = viewOf(doc, 0)

    Vim.handleEx(cmOf(view), 'g/drop/d')

    expect(view.state.doc.toString()).toBe(
      doc
        .split('\n')
        .filter((line) => line.startsWith('keep'))
        .join('\n'),
    )
  })
})
