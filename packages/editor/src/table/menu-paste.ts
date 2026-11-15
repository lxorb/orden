import type { EditorView } from '@codemirror/view'

export const PASTE_TEXT = 'orden:paste-text'

export function editableCellAt(view: EditorView, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const cell = target.closest('td, th')
  if (!(cell instanceof HTMLElement) || cell.contentEditable !== 'true') return null
  return view.contentDOM.contains(cell) ? cell : null
}

export function pasteIntoCell(cell: HTMLElement, text: string): void {
  cell.focus()
  cell.dispatchEvent(new CustomEvent(PASTE_TEXT, { detail: text }))
}
