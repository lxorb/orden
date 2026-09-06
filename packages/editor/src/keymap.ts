import {
  defaultKeymap,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  selectLine,
} from '@codemirror/commands'
import { closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap } from '@codemirror/search'
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
import { runFenceAtCursor } from './run/run'
import { bindings, type BindingSpec } from './shortcuts'
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
export const nibBindings: BindingSpec[] = [
  { id: 'format.bold', key: 'Mod-b', run: toggleWrap('**'), preventDefault: true },
  { id: 'format.italic', key: 'Mod-i', run: toggleWrap('*'), preventDefault: true },
  { id: 'format.underline', key: 'Mod-u', run: toggleWrap('<u>', '</u>'), preventDefault: true },
  { id: 'format.code', key: 'Mod-Shift-`', run: toggleWrap('`'), preventDefault: true },
  { id: 'format.strikethrough', key: 'Alt-Shift-5', run: toggleWrap('~~'), preventDefault: true },
  { id: 'format.highlight', key: 'Mod-Shift-h', run: toggleWrap('=='), preventDefault: true },

  { id: 'format.link', key: 'Mod-k', run: insertLink, preventDefault: true },
  { id: 'format.image', key: 'Mod-Shift-i', run: insertImage, preventDefault: true },
  { id: 'format.clear', key: 'Mod-\\', run: clearFormatting, preventDefault: true },

  { id: 'paragraph.body', key: 'Mod-0', run: setHeading(0), preventDefault: true },
  { id: 'paragraph.heading-1', key: 'Mod-1', run: setHeading(1), preventDefault: true },
  { id: 'paragraph.heading-2', key: 'Mod-2', run: setHeading(2), preventDefault: true },
  { id: 'paragraph.heading-3', key: 'Mod-3', run: setHeading(3), preventDefault: true },
  { id: 'paragraph.heading-4', key: 'Mod-4', run: setHeading(4), preventDefault: true },
  { id: 'paragraph.heading-5', key: 'Mod-5', run: setHeading(5), preventDefault: true },
  { id: 'paragraph.heading-6', key: 'Mod-6', run: setHeading(6), preventDefault: true },
  { id: 'paragraph.heading-up', key: 'Mod-=', run: shiftHeading(1), preventDefault: true },
  { id: 'paragraph.heading-down', key: 'Mod--', run: shiftHeading(-1), preventDefault: true },

  // Ctrl+T opens a new note, the way it opens a tab anywhere else; the table
  // keeps a chord of its own.
  { id: 'paragraph.table', key: 'Mod-Alt-t', run: insertTableToEdit, preventDefault: true },
  { id: 'paragraph.code-block', key: 'Mod-Shift-k', run: insertCodeFence, preventDefault: true },
  { id: 'paragraph.math-block', key: 'Mod-Shift-m', run: insertMathBlock, preventDefault: true },
  { id: 'paragraph.quote', key: 'Mod-Shift-q', run: toggleQuote, preventDefault: true },
  { id: 'paragraph.ordered-list', key: 'Mod-Shift-[', run: toggleOrderedList, preventDefault: true },
  { id: 'paragraph.bullet-list', key: 'Mod-Shift-]', run: toggleBulletList, preventDefault: true },
  { id: 'paragraph.rule', key: 'Mod-Shift-r', run: insertHorizontalRule, preventDefault: true },

  { id: 'edit.indent', key: 'Mod-[', run: indentMore, preventDefault: true },
  { id: 'edit.outdent', key: 'Mod-]', run: indentLess, preventDefault: true },

  // Runs the code fence the caret is in. Falls through to the default when the
  // caret is anywhere else, or the fence is not JavaScript.
  { id: 'edit.run-fence', key: 'Mod-Enter', run: runFenceAtCursor },

  { id: 'edit.select-word', key: 'Mod-d', run: selectWord, preventDefault: true },
  { id: 'edit.select-line', key: 'Mod-l', run: selectLine, preventDefault: true },

  { id: 'edit.copy-markdown', key: 'Mod-Shift-c', run: copyMarkdown, preventDefault: true },
  { id: 'edit.paste-plain', key: 'Mod-Shift-v', run: pastePlain, preventDefault: true },
]

/** CodeMirror's own bindings that this takes over.
 *
 *  Undo, Find, Select all and the rest are shortcuts a reader presses and
 *  would look for in the list, so they are named here and become as
 *  changeable as anything nib defines. The binding object is the one the
 *  library ships - `shift`, `scope` and all - with only its key up for
 *  discussion, and `unclaimedKeymap` below is what is left after these are
 *  taken out of it, so a rebound Undo does not leave the old key working.
 *
 *  What is deliberately not taken over: everything CodeMirror binds that nib
 *  already binds over the top of it (Mod-d, Mod-u, Mod-Shift-k), which would
 *  put a second entry on a key that is already spoken for, and the raw
 *  editing keys - the arrows, Home, Backspace, Enter - which are how a text
 *  editor works rather than shortcuts anyone chose. Those stay in the keymap
 *  underneath and are listed in the settings as fixed, with the reason. */
function adopt(id: string, from: readonly KeyBinding[], key: string, extra: Partial<BindingSpec> = {}): BindingSpec {
  const original = from.find((binding) => binding.key === key)
  if (!original) throw new Error(`no binding for ${key} to adopt as ${id}`)

  adopted.add(original)
  return {
    id,
    key: original.key ?? null,
    mac: original.mac,
    win: original.win,
    linux: original.linux,
    run: original.run,
    shift: original.shift,
    scope: original.scope,
    preventDefault: original.preventDefault,
    ...extra,
  }
}

/** The library's own binding objects that are now spoken for by an id. */
const adopted = new Set<KeyBinding>()

export const standardBindings: BindingSpec[] = [
  adopt('edit.undo', historyKeymap, 'Mod-z'),
  // On Linux the library binds Ctrl+Shift+Z as well as Ctrl+Y, through a
  // second entry with no `key` at all. That entry cannot be reached by key,
  // so it is listed as the second key it is - and stays Linux-only, exactly
  // as it was.
  adopt('edit.redo', historyKeymap, 'Mod-y'),
  {
    id: 'edit.redo.alt',
    key: null,
    linux: 'Ctrl-Shift-z',
    run: historyKeymap.find((binding) => binding.linux === 'Ctrl-Shift-z')!.run,
    preventDefault: true,
    alias: true,
  },
  adopt('edit.select-all', defaultKeymap, 'Mod-a'),
  adopt('edit.find', searchKeymap, 'Mod-f'),
  adopt('edit.find-next', searchKeymap, 'Mod-g'),
  adopt('edit.find-next.alt', searchKeymap, 'F3', { alias: true }),
  adopt('edit.goto-line', searchKeymap, 'Mod-Alt-g'),
  adopt('edit.move-line-up', defaultKeymap, 'Alt-ArrowUp'),
  adopt('edit.move-line-down', defaultKeymap, 'Alt-ArrowDown'),
  adopt('edit.copy-line-up', defaultKeymap, 'Shift-Alt-ArrowUp'),
  adopt('edit.copy-line-down', defaultKeymap, 'Shift-Alt-ArrowDown'),
]

// The Linux-only redo is bound by id now, so it goes out of the keymap below
// with the rest of the ones taken over.
for (const binding of historyKeymap) {
  if (binding.linux === 'Ctrl-Shift-z') adopted.add(binding)
}

/** Everything CodeMirror binds that nothing here has taken over: the keys
 *  that make a text editor a text editor, left exactly as the library has
 *  them and installed underneath the named ones. */
export const unclaimedKeymap: KeyBinding[] = [
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap,
  indentWithTab,
].filter((binding) => !adopted.has(binding))

/** Every binding this file installs, as CodeMirror bindings at their
 *  defaults. The editor itself goes through `boundKeymap` instead, so a
 *  rebind reaches it; this is what tests and callers who only want to know
 *  what the defaults are read. */
export const nibKeymap: KeyBinding[] = bindings(nibBindings, {})
