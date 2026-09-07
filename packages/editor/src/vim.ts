/** Modal editing, through @replit/codemirror-vim.
 *
 *  A compartment like every other mode, so it goes on and off while the editor
 *  is open; what is particular to this one is that Vim wants the whole
 *  keyboard, and the keyboard is already spoken for. Two rules settle that,
 *  and both of them are Nib's rules rather than Vim's:
 *
 *  Every chord held with Ctrl or Cmd belongs to the app. Ctrl+P still opens
 *  the palette in normal mode and Ctrl+B still bolds, which is what makes
 *  modal editing something a reader can turn on without learning the app
 *  again. Vim's own answer to a taken Ctrl chord is Ctrl+Q - it exists
 *  because a terminal eats Ctrl+V - so that one is left alone and visual
 *  block lives there.
 *
 *  And the caret keys belong to the text, which is what the shortcut list has
 *  said about them all along. So an arrow key still walks into a rendered
 *  table and still steps off a selected picture, in normal mode as in insert.
 *  Backspace and Delete are not caret keys and stay Vim's: in normal mode
 *  they are motions there, and an edit would be a surprise.
 *
 *  Both rules are kept by taking the keys off Vim's own keymap once, below,
 *  rather than by racing it for them. A key Vim does not answer to is a key
 *  Vim does not swallow, and everything underneath sees it exactly as it does
 *  with modal editing off. */

import { Compartment, type Extension, Prec, type StateEffect } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { CodeMirror, getCM, Vim, vim } from '@replit/codemirror-vim'
import { once } from './once'
import { redoEdit, undoEdit } from './shared'
import { flushTableEdits } from './table/widget'

export type VimMode = 'normal' | 'insert' | 'visual' | 'replace'

/** What `:w`, `:q` and `:e` do. All three act on the app around the editor -
 *  a note, a tab, the palette - which this package knows nothing about, so the
 *  app says what they mean, the way it hands over its labels. */
export interface VimCommands {
  write(): void
  quit(): void
  edit(): void
}

let commands: VimCommands | null = null

export function setVimCommands(next: VimCommands) {
  commands = next
}

/** Told the mode a view is in whenever it changes, and null when that view
 *  leaves modal editing behind. The app shows it in the status bar. */
export type VimReport = (view: EditorView, mode: VimMode | null) => void

let report: VimReport | null = null

export function onVimMode(next: VimReport) {
  report = next
}

/** `unmap` is declared as needing a context, and a binding that names none -
 *  which is most of them - is matched by passing none. */
const unmap = Vim.unmap as (keys: string, context?: string) => boolean | undefined

const CONTEXTS = [undefined, 'normal', 'insert', 'visual']

/** Takes a key off Vim's keymap in every mode. A key can be bound more than
 *  once in one mode, and `unmap` answers true while it is still finding one.
 *  Answers whether there was anything there to take. */
function takeBack(keys: string): boolean {
  let found = false
  for (const context of CONTEXTS) {
    while (unmap(keys, context)) found = true
  }

  return found
}

/** Every letter but `q`, which is Vim's own way out of a taken Ctrl chord. */
const CTRL_LETTERS = 'abcdefghijklmnoprstuvwxyz'

/** The Ctrl chords Vim binds that are not letters, and the one that waits for
 *  a register after it, which is a prefix rather than a key. */
const CTRL_OTHERS = ['<C-[>', '<C-Space>', '<C-BS>', '<C-Esc>', '<C-r><register>']

/** The keys that move the caret and nothing else. */
const CARET_KEYS = [
  '<Left>',
  '<Right>',
  '<Up>',
  '<Down>',
  '<Home>',
  '<End>',
  '<PageUp>',
  '<PageDown>',
]

/** Everything Nib keeps for itself, taken off Vim's keymap, and which of them
 *  were actually there. Run once at load, because the keymap is the library's
 *  own table and there is one of it; run again by the test, which is how a
 *  chord the library adds in a later version is caught rather than quietly
 *  swallowing somebody's Ctrl+P.
 *
 *  A key with a name longer than one character that Vim does not answer to is
 *  a key Vim leaves alone entirely - it neither runs anything nor stops the
 *  keystroke - so every one of these arrives at the editor and the app exactly
 *  as it does with modal editing off.
 *
 *  What this costs: the library counts its own keymap from the length it
 *  started at, so `:noremap` and `:mapclear` typed into the command line no
 *  longer work. Neither is much use in an editor with no vimrc to read them
 *  from, and `:map` is unaffected. */
export function takeBackNibKeys(): string[] {
  const taken: string[] = []
  const sweep = (keys: string) => {
    if (takeBack(keys)) taken.push(keys)
  }

  for (const letter of CTRL_LETTERS) sweep(`<C-${letter}>`)
  for (const keys of CTRL_OTHERS) sweep(keys)
  for (const keys of CARET_KEYS) sweep(keys)

  return taken
}

takeBackNibKeys()

/** A paragraph in a prose editor is one long wrapped line, so Vim's own `j`
 *  would jump the whole of it. `gj` moves down the screen instead, which is
 *  what a writer means by down, and it is the line every prose vimrc has in
 *  it. Only in normal and visual mode: an operator matches in Vim's
 *  operator-pending context, so `dj` still deletes two whole lines.
 *
 *  Bound to the motion itself rather than written as `j` standing for `gj`.
 *  A key that stands for another key is expanded through Vim's own keymap,
 *  and the keymap is no longer the one Vim shipped; see takeBackNibKeys. */
function moveByScreenLine(keys: string, forward: boolean, context: string) {
  Vim.mapCommand(keys, 'motion', 'moveByDisplayLines', { forward }, { context })
}

for (const context of ['normal', 'visual']) {
  moveByScreenLine('j', true, context)
  moveByScreenLine('k', false, context)
}

Vim.defineEx('write', 'w', () => commands?.write())
Vim.defineEx('quit', 'q', () => commands?.quit())
Vim.defineEx('edit', 'e', () => commands?.edit())

// `u` and `:undo` go to the document's history rather than the view's. A note
// open in two panes is one note with one history, which lives beside the text
// and not in either view - and a joined view's own history is deliberately
// empty, so Vim asking it would find nothing to undo. See shared.ts.
CodeMirror.commands.undo = (cm) => void undoEdit(cm.cm6)
CodeMirror.commands.redo = (cm) => void redoEdit(cm.cm6)

/** The mode as a word, from what the plugin has just written down. Vim names
 *  a visual submode in the same string - `visual line` - and the label has
 *  room for one word. */
function modeOf(mode: string | undefined): VimMode {
  const first = (mode ?? '').split(' ')[0]
  if (first === 'insert' || first === 'visual' || first === 'replace') return first
  return 'normal'
}

/** Tells the app which mode its view is in. Its own plugin rather than the
 *  library's status bar, because the bar the app already has is where this
 *  belongs; installed after `vim()` so the adapter it reads exists. */
const modeReporter = ViewPlugin.define((view: EditorView) => {
  const cm = getCM(view)
  const told = () => report?.(view, modeOf(cm?.state.vim?.mode))

  cm?.on('vim-mode-change', told)
  told()

  return {
    destroy() {
      cm?.off('vim-mode-change', told)
      report?.(view, null)
    },
  }
})

/** The two things modal editing puts on screen, in Nib's own colours.
 *
 *  The library paints its block cursor pink and its command line in whatever
 *  the browser's default monospace is, neither of which belongs to any theme
 *  here. Written against `.nib-vim`, which the compartment puts on the editor,
 *  so each selector carries one class more than the library's own and wins on
 *  its own terms rather than on the order the stylesheets happen to load in. */
const vimTheme = EditorView.theme({
  // The caret becomes a block over the character it is on, which is how a
  // reader tells normal mode from insert at a glance. The character stays
  // legible: the accent behind it, the page colour on top.
  '&.nib-vim .cm-fat-cursor': {
    background: 'var(--accent)',
    color: 'var(--bg)',
    borderRadius: '1px',
  },
  // An editor nobody is typing in shows the block as an outline, the way an
  // unfocused caret stops blinking.
  '&.nib-vim:not(.cm-focused) .cm-fat-cursor': {
    background: 'none',
    outline: '1px solid var(--accent-line)',
    color: 'inherit',
  },
  // The `:` and `/` line, which is the only chrome modal editing adds.
  '&.nib-vim .cm-vim-panel': {
    padding: '4px var(--space-4)',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
  },
  '&.nib-vim .cm-vim-panel input': {
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    caretColor: 'var(--accent)',
  },
})

const modal = new Compartment()

/** Above every keymap. All of CodeMirror's keymaps are dispatched by one
 *  handler at the default precedence, so this is the only way to say that Vim
 *  reads a keystroke first - and it has to, or Enter in normal mode would
 *  carry a list on instead of moving down a line. What Vim must not read is
 *  settled by the keymap it was left with, above. */
/** Built once, for the same reason the other modes are: turning it on again
 *  when it is already on must not tear the keymap down and build it back. See
 *  once.ts. */
const modalEditing = once((on: boolean): Extension =>
  on
    ? Prec.high([
        vim(),
        modeReporter,
        vimTheme,
        EditorView.editorAttributes.of({ class: 'nib-vim' }),
      ])
    : [],
)

export function vimExtensions(): Extension {
  return modal.of([])
}

/** Modal editing as an effect, so a pane taking another note on can put it in
 *  the same transaction as everything else it changes. */
export function vimEffect(on: boolean): StateEffect<unknown> {
  return modal.reconfigure(modalEditing(on))
}

/** Modal editing on or off, in a view that is already open. */
export function setVim(view: EditorView, on: boolean) {
  // A cell may be holding an edit that has not reached the document yet, and
  // the keyboard is about to mean something else.
  flushTableEdits()
  view.dispatch({ effects: vimEffect(on) })
}
