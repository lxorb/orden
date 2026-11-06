import {
  addCursorAbove,
  addCursorBelow,
  defaultKeymap,
  historyKeymap,
  selectLine,
} from '@codemirror/commands'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'
import {
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
import {
  findNext,
  findPrevious,
  gotoLine,
  openFind,
  openReplace,
  selectNextOccurrence,
  selectSelectionMatches,
} from './find'
import { foldHeadings, foldLess, foldMore, toggleFold, unfoldEverything } from './fold'
import { highlightSelection } from './highlight'
import { copyMarkdown } from './copy'
import {
  deleteLine,
  duplicateBlock,
  expandSelection,
  insertLineAbove,
  joinLines,
  lowerCase,
  moveBlockDown,
  moveBlockUp,
  reverseLines,
  shrinkSelection,
  sortLines,
  titleCase,
  upperCase,
  clearFormatting,
  indentItems,
  moveLineOver,
  outdentItems,
} from './line-door'
import { pastePlain } from './paste'
import { runFenceAtCursor } from './run/door'
import { redoEdit, undoEdit } from './shared'
import { bindings, type BindingSpec } from './shortcuts'
import { insertTableToEdit } from './table/keymap'
import { followNoteAtCaret } from './wikilink/follow'

const WORD = /[\p{L}\p{N}_]/u

function isWord(state: EditorState, range: SelectionRange): boolean {
  if (range.empty) return false

  const line = state.doc.lineAt(range.from)
  if (range.to > line.to) return false

  const text = line.text
  const from = range.from - line.from
  const to = range.to - line.from
  if (WORD.test(text.charAt(from - 1)) || WORD.test(text.charAt(to))) return false

  for (let at = from; at < to; at++) {
    if (!WORD.test(text.charAt(at))) return false
  }

  return true
}

export const selectWord: StateCommand = (target) => {
  const { state, dispatch } = target
  if (state.selection.ranges.every((range) => isWord(state, range))) {
    return selectNextOccurrence(target)
  }

  const update = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const text = line.text
    const offset = range.head - line.from

    let from = offset
    let to = offset
    while (from > 0 && WORD.test(text.charAt(from - 1))) from--
    while (to < text.length && WORD.test(text.charAt(to))) to++

    return { range: EditorSelection.range(line.from + from, line.from + to) }
  })

  dispatch(state.update(update))
  return true
}

export const nibBindings: BindingSpec[] = [
  { id: 'format.bold', key: 'Mod-b', run: toggleWrap('**'), preventDefault: true },
  { id: 'format.italic', key: 'Mod-i', run: toggleWrap('*'), preventDefault: true },
  { id: 'format.underline', key: 'Mod-u', run: toggleWrap('<u>', '</u>'), preventDefault: true },
  {
    id: 'format.code',
    key: 'Mod-Shift-`',
    mac: 'Ctrl-`',
    run: toggleWrap('`'),
    preventDefault: true,
  },
  {
    id: 'format.strikethrough',
    key: 'Alt-Shift-5',
    mac: 'Ctrl-Shift-`',
    run: toggleWrap('~~'),
    preventDefault: true,
  },
  { id: 'format.highlight', key: 'Mod-Shift-h', run: highlightSelection, preventDefault: true },

  { id: 'format.link', key: 'Mod-k', run: insertLink, preventDefault: true },
  { id: 'format.image', key: 'Mod-Shift-i', run: insertImage, preventDefault: true },
  { id: 'format.clear', key: 'Mod-\\', run: clearFormatting, preventDefault: true },
  { id: 'format.comment', key: null, run: insertComment, preventDefault: true },

  { id: 'paragraph.body', key: null, run: setHeading(0), preventDefault: true },
  ...[1, 2, 3, 4, 5, 6].map((level): BindingSpec => ({
    id: `paragraph.heading-${level}`,
    key: `Mod-${level}`,
    mac: `Mod-Alt-${level}`,
    run: setHeading(level),
    preventDefault: true,
  })),
  { id: 'paragraph.heading-up', key: 'Mod-Shift-=', run: shiftHeading(1), preventDefault: true },
  { id: 'paragraph.heading-down', key: 'Mod-Shift--', run: shiftHeading(-1), preventDefault: true },

  { id: 'paragraph.table', key: 'Mod-Alt-t', run: insertTableToEdit, preventDefault: true },
  { id: 'paragraph.code-block', key: 'Mod-Shift-k', run: insertCodeFence, preventDefault: true },
  { id: 'paragraph.math-block', key: 'Mod-Shift-m', run: insertMathBlock, preventDefault: true },
  {
    id: 'paragraph.quote',
    key: 'Mod-Shift-q',
    mac: 'Mod-Alt-q',
    run: toggleQuote,
    preventDefault: true,
  },
  {
    id: 'paragraph.ordered-list',
    key: 'Mod-Shift-[',
    mac: null,
    run: toggleOrderedList,
    preventDefault: true,
  },
  {
    id: 'paragraph.bullet-list',
    key: 'Mod-Shift-]',
    mac: null,
    run: toggleBulletList,
    preventDefault: true,
  },
  { id: 'paragraph.rule', key: 'Mod-Shift-r', run: insertHorizontalRule, preventDefault: true },

  { id: 'paragraph.task-list', key: null, run: toggleTaskList, preventDefault: true },
  { id: 'paragraph.callout', key: null, run: insertCallout, preventDefault: true },
  { id: 'paragraph.footnote', key: null, run: insertFootnote, preventDefault: true },
  { id: 'paragraph.toc', key: null, run: insertToc, preventDefault: true },
  { id: 'paragraph.front-matter', key: null, run: insertFrontMatter, preventDefault: true },

  { id: 'edit.indent', key: 'Mod-[', run: indentItems, preventDefault: true },
  { id: 'edit.outdent', key: 'Mod-]', run: outdentItems, preventDefault: true },

  { id: 'view.fold', key: 'Mod-Alt-[', run: toggleFold, preventDefault: true },
  { id: 'view.unfold-all', key: 'Mod-Alt-]', run: unfoldEverything, preventDefault: true },
  { id: 'view.fold-all', key: null, run: foldHeadings, preventDefault: true },
  { id: 'view.fold-more', key: null, run: foldMore, preventDefault: true },
  { id: 'view.fold-less', key: null, run: foldLess, preventDefault: true },

  { id: 'edit.run-fence', key: 'Mod-Enter', run: runFenceAtCursor },
  { id: 'paragraph.task', key: 'Mod-Enter', run: toggleTask, contextual: true },
  {
    id: 'edit.insert-line-above',
    key: 'Mod-Shift-Enter',
    run: insertLineAbove,
    preventDefault: true,
  },

  { id: 'edit.replace', key: 'Mod-h', mac: 'Mod-Alt-f', run: openReplace, preventDefault: true },
  { id: 'edit.find-previous', key: 'Mod-Shift-g', run: findPrevious, preventDefault: true },
  {
    id: 'edit.find-previous.alt',
    key: 'Shift-F3',
    run: findPrevious,
    preventDefault: true,
    alias: true,
  },

  { id: 'edit.select-word', key: null, run: selectWord, preventDefault: true },
  { id: 'edit.select-line', key: 'Mod-l', run: selectLine, preventDefault: true },
  {
    id: 'edit.expand-selection',
    key: 'Shift-Alt-ArrowRight',
    mac: 'Ctrl-Shift-Mod-ArrowRight',
    run: expandSelection,
    preventDefault: true,
  },
  {
    id: 'edit.shrink-selection',
    key: 'Shift-Alt-ArrowLeft',
    mac: 'Ctrl-Shift-Mod-ArrowLeft',
    run: shrinkSelection,
    preventDefault: true,
  },

  { id: 'edit.delete-line', key: null, run: deleteLine, preventDefault: true },
  { id: 'edit.join-lines', key: 'Mod-j', run: joinLines, preventDefault: true },
  { id: 'edit.sort-lines', key: null, run: sortLines, preventDefault: true },
  { id: 'edit.reverse-lines', key: null, run: reverseLines, preventDefault: true },
  { id: 'edit.upper-case', key: null, run: upperCase, preventDefault: true },
  { id: 'edit.lower-case', key: null, run: lowerCase, preventDefault: true },
  { id: 'edit.title-case', key: null, run: titleCase, preventDefault: true },

  { id: 'edit.duplicate-block', key: null, run: duplicateBlock, preventDefault: true },
  { id: 'edit.move-block-up', key: null, run: moveBlockUp, preventDefault: true },
  { id: 'edit.move-block-down', key: null, run: moveBlockDown, preventDefault: true },

  {
    id: 'edit.select-all-occurrences',
    key: null,
    run: selectSelectionMatches,
    preventDefault: true,
  },
  {
    id: 'edit.cursor-above',
    key: 'Mod-Alt-Shift-ArrowUp',
    run: addCursorAbove,
    preventDefault: true,
  },
  {
    id: 'edit.cursor-below',
    key: 'Mod-Alt-Shift-ArrowDown',
    run: addCursorBelow,
    preventDefault: true,
  },

  { id: 'edit.copy-markdown', key: 'Mod-Shift-c', run: copyMarkdown, preventDefault: true },
  { id: 'edit.paste-plain', key: 'Mod-Shift-v', run: pastePlain, preventDefault: true },

  { id: 'edit.follow-link', key: null, run: followNoteAtCaret, preventDefault: true },
]

function adopt(
  id: string,
  from: readonly KeyBinding[],
  key: string,
  extra: Extra = {},
): BindingSpec {
  const original = claim(from, (binding) => binding.key === key, `${key} to adopt as ${id}`)

  const spec: BindingSpec = { id, key: original.key ?? null, run: original.run, ...extra }
  if (original.mac !== undefined) spec.mac = original.mac
  if (original.win !== undefined) spec.win = original.win
  if (original.linux !== undefined) spec.linux = original.linux
  if (original.shift !== undefined) spec.shift = original.shift
  if (original.scope !== undefined) spec.scope = original.scope
  if (original.preventDefault !== undefined) spec.preventDefault = original.preventDefault
  return spec
}

type Extra = Pick<Partial<BindingSpec>, 'alias' | 'run'>

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

const adopted = new Set<KeyBinding>()

const linuxRedo = claim(
  historyKeymap,
  (binding) => binding.linux === 'Ctrl-Shift-z',
  'the Linux redo',
)

claim(defaultKeymap, (binding) => binding.key === 'Mod-/', 'the library comment toggle')

claim(defaultKeymap, (binding) => binding.key === 'Shift-Mod-k', 'the library delete line')
claim(defaultKeymap, (binding) => binding.key === 'Mod-i', 'the library parent syntax')

claim(defaultKeymap, (binding) => binding.key === 'Mod-Alt-ArrowUp', 'the library cursor above')
claim(defaultKeymap, (binding) => binding.key === 'Mod-Alt-ArrowDown', 'the library cursor below')

claim(defaultKeymap, (binding) => binding.key === 'Alt-ArrowLeft', 'the library node left')
claim(defaultKeymap, (binding) => binding.key === 'Alt-ArrowRight', 'the library node right')

export const standardBindings: BindingSpec[] = [
  adopt('edit.undo', historyKeymap, 'Mod-z', { run: undoEdit }),
  adopt('edit.redo', historyKeymap, 'Mod-y', { run: redoEdit }),
  {
    id: 'edit.redo.alt',
    key: null,
    win: 'Ctrl-Shift-z',
    linux: linuxRedo.linux ?? 'Ctrl-Shift-z',
    run: redoEdit,
    preventDefault: true,
    alias: true,
  },
  adopt('edit.select-all', defaultKeymap, 'Mod-a'),
  { id: 'edit.find', key: 'Mod-f', run: openFind, preventDefault: true },
  { id: 'edit.find-next', key: 'Mod-g', run: findNext, preventDefault: true },
  { id: 'edit.find-next.alt', key: 'F3', run: findNext, preventDefault: true, alias: true },
  { id: 'edit.goto-line', key: 'Mod-Alt-g', run: gotoLine },
  adopt('edit.move-line-up', defaultKeymap, 'Alt-ArrowUp', { run: moveLineOver(-1) }),
  adopt('edit.move-line-down', defaultKeymap, 'Alt-ArrowDown', { run: moveLineOver(1) }),
  adopt('edit.copy-line-up', defaultKeymap, 'Shift-Alt-ArrowUp'),
  adopt('edit.copy-line-down', defaultKeymap, 'Shift-Alt-ArrowDown'),
]

export const unclaimedKeymap: KeyBinding[] = [
  ...defaultKeymap,
  ...historyKeymap,
  { key: 'Tab', run: indentItems, shift: outdentItems },
].filter((binding) => !adopted.has(binding))

export const nibKeymap: KeyBinding[] = bindings(nibBindings, {})
