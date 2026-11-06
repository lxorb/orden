import { Compartment, type StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { door } from '@orden/markdown/door'
import { enrolled, openViews } from './open-views'
import { flushTableEdits } from './table/widget'

export type VimMode = 'normal' | 'insert' | 'visual' | 'replace'

export interface VimCommands {
  write(): void
  quit(): void
  edit(): void
}

let commands: VimCommands | null = null

export function setVimCommands(next: VimCommands) {
  commands = next
}

export function vimCommands(): VimCommands | null {
  return commands
}

export type VimReport = (view: EditorView, mode: VimMode | null) => void

let report: VimReport | null = null

export function onVimMode(next: VimReport) {
  report = next
}

export function vimReport(): VimReport | null {
  return report
}

export function modeOf(mode: string | undefined): VimMode {
  const first = (mode ?? '').split(' ')[0]
  if (first === 'insert' || first === 'visual' || first === 'replace') return first
  return 'normal'
}

const modal = new Compartment()

let loaded: typeof import('./vim-mode') | null = null

let wanted = false

export const loadVim: () => Promise<void> = door(async () => {
  loaded = await import('./vim-mode')
  if (!wanted) return

  for (const view of openViews()) view.dispatch({ effects: vimEffect(true) })
})

export function vimExtensions() {
  return [modal.of([]), enrolled]
}

export function vimEffect(on: boolean): StateEffect<unknown> {
  wanted = on
  if (on && !loaded) void loadVim()

  return modal.reconfigure(on && loaded ? loaded.modalEditing(true) : [])
}

export function setVim(view: EditorView, on: boolean) {
  flushTableEdits()
  view.dispatch({ effects: vimEffect(on) })
}
