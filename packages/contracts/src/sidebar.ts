import type { SidebarPanelId } from './shell'

export type SidebarPartId = SidebarPanelId | 'scratchpad'
export interface SidebarMenuItem {
  readonly label: string
  readonly checked?: boolean
  readonly run: () => void
}
export type SidebarMenuEntry = SidebarMenuItem | null
export interface SidebarTool {
  readonly id: string
  readonly label: string
  readonly mark: string
  readonly command?: string
  readonly run: () => void
}
export interface SidebarPart {
  readonly id: SidebarPartId
  readonly tools?: readonly SidebarTool[]
  readonly unread?: () => boolean
  readonly unreadIn?: (root: string) => number
  readonly holdsIn?: (root: string) => boolean
  readonly open?: () => boolean
  readonly toggle?: () => void
  readonly covers?: () => boolean
  readonly spaces?: (ids: readonly string[]) => void
  readonly menu?: () => Promise<readonly SidebarMenuEntry[]>
  readonly toTab?: () => Promise<void>
}
const parts = new Map<SidebarPartId, SidebarPart>()
const hearing = new Set<() => void>()
const told = () => {
  for (const one of hearing) one()
}
export function registerSidebarPart(part: SidebarPart): () => void {
  parts.set(part.id, part)
  told()
  return () => {
    if (parts.get(part.id) !== part) return
    parts.delete(part.id)
    told()
  }
}
export function hearSidebarParts(then: () => void): () => void {
  hearing.add(then)
  return () => void hearing.delete(then)
}
export const sidebarPart = (id: SidebarPartId): SidebarPart | null => parts.get(id) ?? null
