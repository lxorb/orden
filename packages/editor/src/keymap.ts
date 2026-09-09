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
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertMathBlock,
  insertToc,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleTask,
  toggleTaskList,
  toggleWrap,
} from './commands'
import { findPrevious, openReplace } from './find'
import { foldHeadings, toggleFold, unfoldEverything } from './fold'
import { copyMarkdown } from './copy'
import { pastePlain } from './paste'
import { runFenceAtCursor } from './run/run'
import { redoEdit, undoEdit } from './shared'
import { bindings, type BindingSpec } from './shortcuts'
import { insertTableToEdit } from './table/keymap'
import { followNoteAtCaret } from './wikilink/follow'

const WORD = /[\p{L}\p{N}_]/u

/** Typora's Ctrl+D: grow the selection to the word under the caret. */
export const selectWord: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const text = line.text
    const offset = range.head - line.from

    // `charAt` past either end of the line answers with the empty string,
    // which is not a word character, so the walk stops there on its own.
    let from = offset
    let to = offset
    while (from > 0 && WORD.test(text.charAt(from - 1))) from--
    while (to < text.length && WORD.test(text.charAt(to))) to++

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
  // No key out of the box: a comment is written now and then, and every chord
  // left free is a chord somebody can spend on what they do write often.
  { id: 'format.comment', key: null, run: insertComment, preventDefault: true },

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
  {
    id: 'paragraph.ordered-list',
    key: 'Mod-Shift-[',
    run: toggleOrderedList,
    preventDefault: true,
  },
  { id: 'paragraph.bullet-list', key: 'Mod-Shift-]', run: toggleBulletList, preventDefault: true },
  { id: 'paragraph.rule', key: 'Mod-Shift-r', run: insertHorizontalRule, preventDefault: true },

  // The four blocks that are a menu row and not a chord anybody would guess.
  // Each is in the list so it can be given one; none takes a key nobody asked
  // for. Task list is the exception below, because ticking a box is a thing
  // somebody does over and over.
  { id: 'paragraph.task-list', key: null, run: toggleTaskList, preventDefault: true },
  { id: 'paragraph.callout', key: null, run: insertCallout, preventDefault: true },
  { id: 'paragraph.footnote', key: null, run: insertFootnote, preventDefault: true },
  { id: 'paragraph.toc', key: null, run: insertToc, preventDefault: true },
  { id: 'paragraph.front-matter', key: null, run: insertFrontMatter, preventDefault: true },

  { id: 'edit.indent', key: 'Mod-[', run: indentMore, preventDefault: true },
  { id: 'edit.outdent', key: 'Mod-]', run: indentLess, preventDefault: true },

  // The bracket pair again, one modifier further out, because folding is the
  // same shape of idea as indenting - open this up, close this down - and the
  // brackets are where every editor puts it. `[` folds where you are; `]` opens
  // the whole note, which is the press somebody makes when they have lost
  // their way. Folding everything is the deliberate one and it is a menu row
  // and a palette row: a chord for it would be a chord spent on the press
  // nobody makes twice.
  { id: 'view.fold', key: 'Mod-Alt-[', run: toggleFold, preventDefault: true },
  { id: 'view.unfold-all', key: 'Mod-Alt-]', run: unfoldEverything, preventDefault: true },
  { id: 'view.fold-all', key: null, run: foldHeadings, preventDefault: true },

  // Runs the code fence the caret is in. Falls through to the default when the
  // caret is anywhere else, or the fence is not JavaScript.
  { id: 'edit.run-fence', key: 'Mod-Enter', run: runFenceAtCursor },
  // Ticks the box on the line the caret is on, and shares the key above: a line
  // is a task or it is code, and both of these give way when it is not theirs.
  // Under the fence, so `- [ ] x` written inside one is still code.
  { id: 'paragraph.task', key: 'Mod-Enter', run: toggleTask, contextual: true },

  // Find with the caret in the replace field, since CodeMirror's own panel holds
  // both. Ctrl+H is what Typora and Obsidian use; a Mac keeps Cmd+H for hiding
  // the application, so there it is the Find-and-replace chord instead.
  { id: 'edit.replace', key: 'Mod-h', mac: 'Mod-Alt-f', run: openReplace, preventDefault: true },
  // The library pairs previous onto next through a Shift handler; here it is a
  // command with a name of its own, on the two keys every editor uses for it. The
  // scope is the library's own for Find: the keys have to work while the keyboard
  // is in the search panel, which is where it is after Find opened it.
  {
    id: 'edit.find-previous',
    key: 'Mod-Shift-g',
    run: findPrevious,
    scope: 'editor search-panel',
    preventDefault: true,
  },
  {
    id: 'edit.find-previous.alt',
    key: 'Shift-F3',
    run: findPrevious,
    scope: 'editor search-panel',
    preventDefault: true,
    alias: true,
  },

  { id: 'edit.select-word', key: 'Mod-d', run: selectWord, preventDefault: true },
  { id: 'edit.select-line', key: 'Mod-l', run: selectLine, preventDefault: true },

  { id: 'edit.copy-markdown', key: 'Mod-Shift-c', run: copyMarkdown, preventDefault: true },
  { id: 'edit.paste-plain', key: 'Mod-Shift-v', run: pastePlain, preventDefault: true },

  // No key of its own: Ctrl+click is how a link is followed here, and a second
  // way of doing it is not worth a chord out of the box. It is listed so a
  // reader can give it one, and so the Obsidian preset has somewhere to put
  // Alt+Enter.
  { id: 'edit.follow-link', key: null, run: followNoteAtCaret, preventDefault: true },
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
function adopt(
  id: string,
  from: readonly KeyBinding[],
  key: string,
  extra: Extra = {},
): BindingSpec {
  const original = claim(from, (binding) => binding.key === key, `${key} to adopt as ${id}`)

  // Only the fields the library actually set are copied across. An absent
  // `mac` and a `mac` of undefined mean the same thing to `defaultKeyFor`, but
  // not to the compiler, and not to anyone reading a spec to see which
  // platforms it names.
  const spec: BindingSpec = { id, key: original.key ?? null, run: original.run, ...extra }
  if (original.mac !== undefined) spec.mac = original.mac
  if (original.win !== undefined) spec.win = original.win
  if (original.linux !== undefined) spec.linux = original.linux
  if (original.shift !== undefined) spec.shift = original.shift
  if (original.scope !== undefined) spec.scope = original.scope
  if (original.preventDefault !== undefined) spec.preventDefault = original.preventDefault
  return spec
}

/** What an adopted binding may be told about itself that the library's own
 *  entry cannot say: that it is a second key for the same command, or that
 *  something other than the library's own command answers to it. */
type Extra = Pick<Partial<BindingSpec>, 'alias' | 'run'>

/** The same binding without the library's Shift partner. */
function unpaired(spec: BindingSpec): BindingSpec {
  const alone = { ...spec }
  delete alone.shift
  return alone
}

/** Takes one of the library's bindings over by name, or fails loudly. A key
 *  the library no longer binds would otherwise become a named shortcut with no
 *  command behind it, which reads in the settings as a key that simply does
 *  nothing. */
function claim(
  from: readonly KeyBinding[],
  match: (binding: KeyBinding) => boolean,
  what: string,
): KeyBinding & Pick<BindingSpec, 'run'> {
  const original = from.find(match)
  if (!original?.run) throw new Error(`no binding for ${what}`)
  adopted.add(original)
  return { ...original, run: original.run }
}

/** The library's own binding objects that are now spoken for by an id. */
const adopted = new Set<KeyBinding>()

/** The library's Linux-only redo. Claimed here so its entry goes out of
 *  `unclaimedKeymap` below and the key is not bound twice; only the key is kept,
 *  since the command that answers it is now the app's own. */
const linuxRedo = claim(
  historyKeymap,
  (binding) => binding.linux === 'Ctrl-Shift-z',
  'the Linux redo',
)

/** The library's own comment toggle, taken off its key and given no other.
 *
 *  `Ctrl+/` is source mode here, which is Typora's key for it and the one the
 *  settings list shows. The library binds the same chord to its own comment
 *  command, and both were firing: the mode changed and the line the caret was on
 *  quietly gained a `<!--` and a `-->`. Claimed rather than adopted, because
 *  writing a comment is Format's own row now - see `insertComment` - and a second
 *  command for it on a key that already means something else is exactly the
 *  invisible binding the specs exist to prevent. */
claim(defaultKeymap, (binding) => binding.key === 'Mod-/', 'the library comment toggle')

export const standardBindings: BindingSpec[] = [
  // The library's own key, on the app's own undo: a note open in two panes has
  // one history, which lives with the document rather than in either view. See
  // shared.ts. Without a shared document these are the library's commands.
  adopt('edit.undo', historyKeymap, 'Mod-z', { run: undoEdit }),
  // On Linux the library binds Ctrl+Shift+Z as well as Ctrl+Y, through a
  // second entry with no `key` at all. That entry cannot be reached by key,
  // so it is listed as the second key it is - and stays Linux-only, exactly
  // as it was.
  adopt('edit.redo', historyKeymap, 'Mod-y', { run: redoEdit }),
  {
    id: 'edit.redo.alt',
    key: null,
    linux: linuxRedo.linux ?? 'Ctrl-Shift-z',
    run: redoEdit,
    preventDefault: true,
    alias: true,
  },
  adopt('edit.select-all', defaultKeymap, 'Mod-a'),
  adopt('edit.find', searchKeymap, 'Mod-f'),
  // Unpaired: the library carries Find previous on these two as a Shift handler,
  // and a key that quietly runs a second command is a key nobody can rebind.
  // Find previous has entries of its own in nibBindings above.
  unpaired(adopt('edit.find-next', searchKeymap, 'Mod-g')),
  unpaired(adopt('edit.find-next.alt', searchKeymap, 'F3', { alias: true })),
  adopt('edit.goto-line', searchKeymap, 'Mod-Alt-g'),
  adopt('edit.move-line-up', defaultKeymap, 'Alt-ArrowUp'),
  adopt('edit.move-line-down', defaultKeymap, 'Alt-ArrowDown'),
  adopt('edit.copy-line-up', defaultKeymap, 'Shift-Alt-ArrowUp'),
  adopt('edit.copy-line-down', defaultKeymap, 'Shift-Alt-ArrowDown'),
]

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
