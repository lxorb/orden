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

import { Compartment, type Extension, Prec } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { getCM, Vim, vim } from '@replit/codemirror-vim'
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
 *  swallowing somebody's Ctrl+P. */
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

// A paragraph in a prose editor is one long wrapped line, so Vim's own `j`
// would jump the whole of it. `gj` moves down the screen instead, which is
// what a writer means by down; it is the mapping every prose vimrc has. Only
// in normal and visual mode - an operator like `dj` matches in Vim's
// operator-pending context, so `dj` still deletes two whole lines.
Vim.noremap('j', 'gj', 'normal')
Vim.noremap('k', 'gk', 'normal')
Vim.noremap('j', 'gj', 'visual')
Vim.noremap('k', 'gk', 'visual')

Vim.defineEx('write', 'w', () => commands?.write())
Vim.defineEx('quit', 'q', () => commands?.quit())
Vim.defineEx('edit', 'e', () => commands?.edit())

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

const modal = new Compartment()

/** Above every keymap. All of CodeMirror's keymaps are dispatched by one
 *  handler at the default precedence, so this is the only way to say that Vim
 *  reads a keystroke first - and it has to, or Enter in normal mode would
 *  carry a list on instead of moving down a line. What Vim must not read is
 *  settled by the keymap it was left with, above. */
function modalEditing(): Extension {
  return Prec.high([vim(), modeReporter, EditorView.editorAttributes.of({ class: 'nib-vim' })])
}

export function vimExtensions(): Extension {
  return modal.of([])
}

/** Modal editing on or off, in a view that is already open. */
export function setVim(view: EditorView, on: boolean) {
  // A cell may be holding an edit that has not reached the document yet, and
  // the keyboard is about to mean something else.
  flushTableEdits()
  view.dispatch({ effects: modal.reconfigure(on ? modalEditing() : []) })
}
