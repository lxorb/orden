import { openBaseFile, openLabel, openProject, openTodos } from './open'
import type { ViewSpec } from './spec'

export type PanelRow =
  | { kind: 'todos'; space?: string }
  | { kind: 'project'; space: string; path: string }
  | { kind: 'label'; tag: string; space?: string }
  | { kind: 'base'; path: string }

export interface Press {
  button?: number
  ctrlKey?: boolean
  metaKey?: boolean
}

export function choose(press: Press): 'select' | 'tab' {
  if (press.button === 1) return 'tab'
  return press.ctrlKey === true || press.metaKey === true ? 'tab' : 'select'
}

export function sameRow(a: PanelRow | null, b: PanelRow): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

interface Here {
  id: string
  name: string
  root: string
}

export function chosenIn(pressed: { row: PanelRow; in: Here | null }, here: Here | null): PanelRow {
  const { row, in: was } = pressed
  if (was?.id !== here?.id) return TODOS
  if (!was || !here || was.root === here.root) return row
  if (row.kind === 'base') return TODOS
  return 'space' in row && row.space === was.name ? { ...row, space: here.name } : row
}

const TODOS: PanelRow = { kind: 'todos' }

export function specOf(row: PanelRow): ViewSpec | null {
  switch (row.kind) {
    case 'todos':
      return row.space === undefined ? { builtin: 'todos' } : { builtin: 'todos', space: row.space }
    case 'project':
      return { builtin: 'project', space: row.space, path: row.path }
    case 'label':
      return row.space === undefined
        ? { builtin: 'label', tag: row.tag }
        : { builtin: 'label', space: row.space, tag: row.tag }
    case 'base':
      return null
  }
}

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
      if (row.space === undefined) openLabel(row.tag, how)
      else openLabel(row.tag, how, row.space)
      return
    case 'base':
      openBaseFile(row.path, how)
  }
}
