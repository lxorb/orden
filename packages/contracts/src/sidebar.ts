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
  readonly open?: () => boolean
  readonly toggle?: () => void
  readonly covers?: () => boolean
  readonly spaces?: (ids: readonly string[]) => void
  readonly menu?: () => Promise<readonly SidebarMenuEntry[]>
  readonly toTab?: () => Promise<void>
}
const parts = new Map<SidebarPartId, SidebarPart>()
export function registerSidebarPart(part: SidebarPart): () => void {
  parts.set(part.id, part)
  return () => {
    if (parts.get(part.id) === part) parts.delete(part.id)
  }
}
export const sidebarPart = (id: SidebarPartId): SidebarPart | null => parts.get(id) ?? null
