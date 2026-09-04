import { indentLess, indentMore, selectLine } from '@codemirror/commands'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'
import {
  clearFormatting,
  insertCodeFence,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertMathBlock,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleWrap,
} from './commands'
import { copyMarkdown, pastePlain } from './paste'
import { insertTableToEdit } from './table/keymap'

const WORD = /[\p{L}\p{N}_]/u

/** Typora's Ctrl+D: grow the selection to the word under the caret. */
export const selectWord: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const text = line.text
    const offset = range.head - line.from

    let from = offset
    let to = offset
    while (from > 0 && WORD.test(text[from - 1])) from--
    while (to < text.length && WORD.test(text[to])) to++

    return { range: EditorSelection.range(line.from + from, line.from + to) }
  })

  dispatch(state.update(update))
  return true
}

/** Mirrors Typora's shortcut table so muscle memory carries over. */
export const nibKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleWrap('**'), preventDefault: true },
  { key: 'Mod-i', run: toggleWrap('*'), preventDefault: true },
  { key: 'Mod-u', run: toggleWrap('<u>', '</u>'), preventDefault: true },
  { key: 'Mod-Shift-`', run: toggleWrap('`'), preventDefault: true },
  { key: 'Alt-Shift-5', run: toggleWrap('~~'), preventDefault: true },
  { key: 'Mod-Shift-h', run: toggleWrap('=='), preventDefault: true },

  { key: 'Mod-k', run: insertLink, preventDefault: true },
  { key: 'Mod-Shift-i', run: insertImage, preventDefault: true },
  { key: 'Mod-\\', run: clearFormatting, preventDefault: true },

  { key: 'Mod-0', run: setHeading(0), preventDefault: true },
  { key: 'Mod-1', run: setHeading(1), preventDefault: true },
  { key: 'Mod-2', run: setHeading(2), preventDefault: true },
  { key: 'Mod-3', run: setHeading(3), preventDefault: true },
  { key: 'Mod-4', run: setHeading(4), preventDefault: true },
  { key: 'Mod-5', run: setHeading(5), preventDefault: true },
  { key: 'Mod-6', run: setHeading(6), preventDefault: true },
  { key: 'Mod-=', run: shiftHeading(1), preventDefault: true },
  { key: 'Mod--', run: shiftHeading(-1), preventDefault: true },

  { key: 'Mod-t', run: insertTableToEdit, preventDefault: true },
  { key: 'Mod-Shift-k', run: insertCodeFence, preventDefault: true },
  { key: 'Mod-Shift-m', run: insertMathBlock, preventDefault: true },
  { key: 'Mod-Shift-q', run: toggleQuote, preventDefault: true },
  { key: 'Mod-Shift-[', run: toggleOrderedList, preventDefault: true },
  { key: 'Mod-Shift-]', run: toggleBulletList, preventDefault: true },
  { key: 'Mod-Shift-r', run: insertHorizontalRule, preventDefault: true },

  { key: 'Mod-[', run: indentMore, preventDefault: true },
  { key: 'Mod-]', run: indentLess, preventDefault: true },

  { key: 'Mod-d', run: selectWord, preventDefault: true },
  { key: 'Mod-l', run: selectLine, preventDefault: true },

  copyMarkdown,
  pastePlain,
]
