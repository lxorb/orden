import type { IconNode } from 'lucide'

export interface MenuItem {
  label: string
  icon?: IconNode
  hint?: string | undefined
  command?: string
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  keep?: boolean
  asks?: boolean
  more?: () => Promise<MenuEntry[]>
  run: () => void
}

export const DIVIDER = null

export type MenuEntry = MenuItem | typeof DIVIDER

export interface MenuSubmenu {
  label: string
  disabled?: boolean
  rows: MenuRow[]
}

export type MenuRow = MenuItem | MenuSubmenu | typeof DIVIDER

export function isSubmenu(row: MenuRow): row is MenuSubmenu {
  return row !== DIVIDER && 'rows' in row
}

export function walkableRows(rows: readonly MenuRow[]): number[] {
  const out: number[] = []
  for (const [index, row] of rows.entries()) {
    if (row !== DIVIDER && !row.disabled) out.push(index)
  }

  return out
}

export interface MenuGroup {
  id: string
  label: string
  rows: MenuRow[]
}
