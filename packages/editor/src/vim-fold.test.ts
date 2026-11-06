// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { foldLines, folding } from './fold'
import { unclaimedKeymap } from './keymap'
import { loadLineCommands } from './line-door'
import { nibMarkdownExtensions } from './markdown/extensions'
import { loadVim } from './vim'
import { modalEditing, normalTab } from './vim-mode'

beforeAll(async () => {
  await loadVim()
  await loadLineCommands()
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
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        folding(),
        modalEditing(true),
        keymap.of(unclaimedKeymap),
      ],
    }),
    parent: document.body,
  })
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  view.dispatch({})
  open.push(view)
  return view
}

function press(view: EditorView, key: string, shiftKey = false) {
  const keyCode = ({ Tab: 9, Escape: 27 } as Record<string, number>)[key] ?? 0
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, keyCode, shiftKey, bubbles: true, cancelable: true }),
  )
}

const NOTE = '# One\n\nfirst\n\n## Under one\n\nnested\n\n# Two\n\n- a\n  - b\n  - c\n- d\n'

describe('Tab in normal mode, as Org mode has it', () => {
  test('folds the heading the caret is on, and opens it again', () => {
    const view = viewOf(NOTE, 2)
    press(view, 'Tab')
    expect(foldLines(view.state)).toEqual([[1, 7]])

    press(view, 'Tab')
    expect(foldLines(view.state)).toEqual([])
    expect(view.state.doc.toString()).toBe(NOTE)
  })

  test('folds a list item over the items nested under it, and writes nothing', () => {
    const view = viewOf(NOTE, NOTE.indexOf('- a') + 2)
    press(view, 'Tab')
    expect(foldLines(view.state)).toEqual([[11, 13]])
    expect(view.state.doc.toString()).toBe(NOTE)
  })

  test('never indents the line, even where there is nothing to fold', () => {
    const flat = '- one\n- two\n'
    const view = viewOf(flat, flat.indexOf('two'))
    press(view, 'Tab')
    expect(view.state.doc.toString()).toBe(flat)
  })

  test('Shift+Tab folds every heading, and again opens everything', () => {
    const view = viewOf(NOTE, NOTE.indexOf('nested'))
    press(view, 'Tab', true)
    expect(foldLines(view.state)).toEqual([
      [1, 7],
      [9, 14],
    ])

    press(view, 'Tab', true)
    expect(foldLines(view.state)).toEqual([])
    expect(view.state.doc.toString()).toBe(NOTE)
  })

  test('right after Escape leaves insert mode, and again after Escape in normal mode', async () => {
    const view = viewOf(NOTE, 2)
    const cm = getCM(view)
    if (!cm) throw new Error('no Vim in the view')
    Vim.handleKey(cm, 'i', 'user')

    press(view, 'Escape')
    await Promise.resolve()
    expect(cm.state.vim?.insertMode).toBe(false)
    press(view, 'Tab')
    expect(foldLines(view.state)).toEqual([[1, 7]])

    press(view, 'Escape')
    await Promise.resolve()
    press(view, 'Tab')
    expect(foldLines(view.state)).toEqual([])
  })

  test('in insert mode is still the indent it always was', () => {
    const flat = '- one\n- two\n'
    const view = viewOf(flat, flat.indexOf('two'))
    const cm = getCM(view)
    if (!cm) throw new Error('no Vim in the view')
    Vim.handleKey(cm, 'i', 'user')

    press(view, 'Tab')
    expect(view.state.doc.toString()).not.toBe(flat)
    expect(foldLines(view.state)).toEqual([])
  })
})

describe("Vim's own fold keys", () => {
  function keys(view: EditorView, typed: string) {
    const cm = getCM(view)
    if (!cm) throw new Error('no Vim in the view')
    for (const key of typed) Vim.handleKey(cm, key, 'user')
  }

  test('za folds and opens, zc only folds, zo only opens', () => {
    const view = viewOf(NOTE, 2)
    keys(view, 'za')
    expect(foldLines(view.state)).toEqual([[1, 7]])
    keys(view, 'za')
    expect(foldLines(view.state)).toEqual([])

    keys(view, 'zo')
    expect(foldLines(view.state)).toEqual([])
    keys(view, 'zc')
    expect(foldLines(view.state)).toEqual([[1, 7]])
    keys(view, 'zc')
    expect(foldLines(view.state)).toEqual([[1, 7]])
    keys(view, 'zo')
    expect(foldLines(view.state)).toEqual([])
    expect(view.state.doc.toString()).toBe(NOTE)
  })

  test('zM folds every heading and zR opens everything', () => {
    const view = viewOf(NOTE, NOTE.indexOf('- a'))
    keys(view, 'zM')
    expect(foldLines(view.state)).toEqual([
      [1, 7],
      [9, 14],
    ])
    keys(view, 'zR')
    expect(foldLines(view.state)).toEqual([])
  })
})

describe('Tab, as normal mode reads it', () => {
  const tab = {
    key: 'Tab',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
  }
  const idle = { prefixRepeat: [], operator: null, keyBuffer: [] }
  const normal = { insertMode: false, visualMode: false, inputState: idle }

  test('is one fold alone and every heading with Shift', () => {
    expect(normalTab(tab, normal)).toBe('one')
    expect(normalTab({ ...tab, shiftKey: true }, normal)).toBe('all')
  })

  test('is nothing in insert or visual mode, mid-command, in a chord or with no Vim', () => {
    expect(normalTab(tab, { ...normal, insertMode: true })).toBeNull()
    expect(normalTab(tab, { ...normal, visualMode: true })).toBeNull()
    expect(normalTab(tab, { ...normal, inputState: { ...idle, operator: 'delete' } })).toBeNull()
    expect(normalTab(tab, { ...normal, inputState: { ...idle, prefixRepeat: ['2'] } })).toBeNull()
    expect(normalTab({ ...tab, ctrlKey: true }, normal)).toBeNull()
    expect(normalTab({ ...tab, altKey: true }, normal)).toBeNull()
    expect(normalTab({ ...tab, key: 'Enter' }, normal)).toBeNull()
    expect(normalTab(tab, null)).toBeNull()
  })
})
