import { type Extension, Prec } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { backtracksWildly } from '@orden/markdown/pattern-cost'
import { CodeMirror, getCM, Vim, vim } from '@replit/codemirror-vim'
import { tickTaskAtCaret } from './commands'
import {
  cycleAllFolds,
  foldAtCaret,
  foldHeadings,
  toggleFold,
  unfoldAtCaret,
  unfoldEverything,
} from './fold'
import { once } from './once'
import { redoEdit, undoEdit } from './shared'
import { modeOf, vimCommands, vimReport } from './vim'

Object.assign(Vim, {
  patternGuard: (pattern: RegExp) => !backtracksWildly(pattern.source, pattern.flags),
})

const unmap = Vim.unmap as (keys: string, context?: string) => boolean | undefined

const CONTEXTS = [undefined, 'normal', 'insert', 'visual']

function takeBack(keys: string): number {
  let found = 0
  for (const context of CONTEXTS) {
    while (unmap(keys, context)) found++
  }

  return found
}

const HOLDING_PLACE = { keys: '<OrdenTaken>', type: 'idle' } as const

const CTRL_LETTERS = 'abcdefghijklmnoprstuvwxyz'

const CTRL_OTHERS = ['<C-[>', '<C-Space>', '<C-BS>', '<C-Esc>', '<C-r><register>']

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

export function takeBackOrdenKeys(): string[] {
  const taken: string[] = []
  let bindings = 0
  const sweep = (keys: string) => {
    const found = takeBack(keys)
    bindings += found
    if (found) taken.push(keys)
  }

  for (const letter of CTRL_LETTERS) sweep(`<C-${letter}>`)
  for (const keys of CTRL_OTHERS) sweep(keys)
  for (const keys of CARET_KEYS) sweep(keys)
  for (let one = 0; one < bindings; one++) Vim._mapCommand({ ...HOLDING_PLACE })

  return taken
}

takeBackOrdenKeys()

function moveByScreenLine(keys: string, forward: boolean, context: string) {
  Vim.mapCommand(keys, 'motion', 'moveByDisplayLines', { forward }, { context })
}

for (const context of ['normal', 'visual']) {
  moveByScreenLine('j', true, context)
  moveByScreenLine('k', false, context)
}

const FOLD_KEYS = {
  za: toggleFold,
  zc: foldAtCaret,
  zo: unfoldAtCaret,
  zM: foldHeadings,
  zR: unfoldEverything,
}

for (const [keys, command] of Object.entries(FOLD_KEYS)) {
  Vim.defineAction(keys, (cm) => void command(cm.cm6 as EditorView))
  Vim.mapCommand(keys, 'action', keys, {}, { context: 'normal' })
}

Vim.defineEx('write', 'w', () => vimCommands()?.write())
Vim.defineEx('quit', 'q', () => vimCommands()?.quit())
Vim.defineEx('edit', 'e', () => vimCommands()?.edit())

CodeMirror.commands.undo = (cm) => void undoEdit(cm.cm6)
CodeMirror.commands.redo = (cm) => void redoEdit(cm.cm6)

const modeReporter = ViewPlugin.define((view: EditorView) => {
  const cm = getCM(view)
  const told = () => vimReport()?.(view, modeOf(cm?.state.vim?.mode))

  cm?.on('vim-mode-change', told)
  told()

  return {
    destroy() {
      cm?.off('vim-mode-change', told)
      vimReport()?.(view, null)
    },
  }
})

interface Keyed {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
}

interface Moded {
  insertMode: boolean
  visualMode: boolean
  inputState: {
    prefixRepeat: string[]
    operator?: string | null | undefined
    keyBuffer: string[]
    registerName?: string | undefined
  }
}

function idleNormal(event: Keyed, mode: Moded | null | undefined): boolean {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  if (!mode || mode.insertMode || mode.visualMode) return false

  const input = mode.inputState
  return (
    !input.prefixRepeat.length && !input.operator && !input.keyBuffer.length && !input.registerName
  )
}

export function plainNormalEnter(event: Keyed, mode: Moded | null | undefined): boolean {
  return event.key === 'Enter' && !event.shiftKey && idleNormal(event, mode)
}

export function normalTab(event: Keyed, mode: Moded | null | undefined): 'one' | 'all' | null {
  if (event.key !== 'Tab' || !idleNormal(event, mode)) return null
  return event.shiftKey ? 'all' : 'one'
}

function keepTabForFolds(view: EditorView) {
  queueMicrotask(() => {
    const mode = getCM(view)?.state.vim
    if (mode && !mode.insertMode && !mode.visualMode) view.setTabFocusMode(false)
  })
}

const normalKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      const mode = getCM(view)?.state.vim
      if (event.key === 'Escape') keepTabForFolds(view)

      const tab = normalTab(event, mode)
      if (tab) {
        if (tab === 'one') toggleFold(view)
        else cycleAllFolds(view)
      } else if (!plainNormalEnter(event, mode) || !tickTaskAtCaret(view)) return false

      event.preventDefault()
      return true
    },
  }),
)

const vimTheme = EditorView.theme({
  '&.orden-vim .cm-fat-cursor': {
    background: 'var(--accent)',
    color: 'var(--bg)',
    borderRadius: '1px',
  },
  '&.orden-vim:not(.cm-focused) .cm-fat-cursor': {
    background: 'none',
    outline: '1px solid var(--accent-line)',
    color: 'inherit',
  },
  '&.orden-vim .cm-vim-panel': {
    padding: '4px var(--space-4)',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
  },
  '&.orden-vim .cm-vim-panel input': {
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    caretColor: 'var(--accent)',
  },
})

export const modalEditing = once((on: boolean): Extension =>
  on
    ? Prec.high([
        vim(),
        normalKeys,
        modeReporter,
        vimTheme,
        EditorView.editorAttributes.of({ class: 'orden-vim' }),
      ])
    : [],
)
