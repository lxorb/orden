/** What a press on a row of the Tasks panel does (#374): the one place it is decided for
 *  every row - Todos, a favourite, a label. A plain press chooses the row, and its list
 *  is drawn in the panel under the rows; no tab opens. A tab is asked for: Ctrl or Cmd
 *  and a press, the middle button, or the row's menu, Open in new tab.
 *
 *  `choose` is pure; `openInTab` is what the asking does. */

import { openBaseFile, openLabel, openProject, openTodos } from './open'
import type { ViewSpec } from './spec'

/** A row of the panel, as what it shows. */
export type PanelRow =
  | { kind: 'todos'; space?: string }
  | { kind: 'project'; space: string; path: string }
  | { kind: 'label'; tag: string }
  | { kind: 'base'; path: string }

/** The keys and the button a press came with. */
export interface Press {
  button?: number
  ctrlKey?: boolean
  metaKey?: boolean
}

/** Whether a press chooses the row in the panel or asks for it in a tab of its own. */
export function choose(press: Press): 'select' | 'tab' {
  if (press.button === 1) return 'tab'
  return press.ctrlKey === true || press.metaKey === true ? 'tab' : 'select'
}

/** Whether two rows are the same one: what the panel marks as chosen. */
export function sameRow(a: PanelRow | null, b: PanelRow): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

/** The view a row shows, as a tab would ask for it; a base file is its path instead. */
export function specOf(row: PanelRow): ViewSpec | null {
  switch (row.kind) {
    case 'todos':
      return row.space === undefined ? { builtin: 'todos' } : { builtin: 'todos', space: row.space }
    case 'project':
      return { builtin: 'project', space: row.space, path: row.path }
    case 'label':
      return { builtin: 'label', tag: row.tag }
    case 'base':
      return null
  }
}

/** The row in a tab of its own, kept rather than a preview another press replaces. */
export function openInTab(row: PanelRow): void {
  const how = { preview: false }
  switch (row.kind) {
    case 'todos':
      openTodos(row.space, how)
      return
    case 'project':
      openProject(row.space, row.path, undefined, how)
      return
    case 'label':
      openLabel(row.tag, how)
      return
    case 'base':
      openBaseFile(row.path, how)
  }
}
