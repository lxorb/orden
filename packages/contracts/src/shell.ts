import type { CommandId } from './ids'
import type { Result } from './result'

export type FileMark =
  | 'note'
  | 'folder'
  | 'canvas'
  | 'pages'
  | 'pdf'
  | 'picture'
  | 'file'
  | 'web'
  | 'terminal'
  | 'remote'
  | 'base'
  | 'chat'
  | 'application'
  | 'key'
  | 'time'
  | 'settings'

export type TabPanel = 'outline' | 'links'

export interface TabKindTraits {
  readonly words: boolean
  readonly extension: string | null
  readonly statusBar: boolean
  readonly mark: FileMark | null
  readonly glyph: 'graph' | 'ask' | null
  readonly liveMark: boolean
  readonly editor: boolean
  readonly takesDrops: boolean
  readonly ownBar: boolean
  readonly fileDocument: boolean
  readonly plane: boolean
  readonly exports: 'note' | 'canvas' | 'pages' | 'file' | 'none'
  readonly selection: 'words' | 'drawing' | 'terminal' | 'page' | null
  readonly outsideTitle: boolean
  readonly preview: 'reading' | 'scrollback' | 'photograph' | 'drawn' | 'picture' | 'mark'
  readonly panels: readonly TabPanel[]
  readonly asksToMove: boolean
  readonly single: boolean
}

export const TAB_KINDS = [
  'note',
  'graph',
  'pdf',
  'canvas',
  'pages',
  'web',
  'terminal',
  'view',
  'chat',
  'channel',
  'application',
  'explorer',
  'pass',
  'time',
  'settings',
] as const

export type TabKind = (typeof TAB_KINDS)[number]

export function isTabKind(value: unknown): value is TabKind {
  return typeof value === 'string' && (TAB_KINDS as readonly string[]).includes(value)
}

export interface TabKindExtension {
  readonly kind: TabKind
  readonly traits: TabKindTraits
}

export interface CommandExtension {
  readonly id: CommandId
  readonly label: string
  readonly hint?: string
  readonly also?: readonly string[]
  readonly byHand?: boolean
  readonly ownWindow?: boolean
  readonly checked?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly run: () => void | Promise<void>
}

export type SettingsSectionId =
  | 'general'
  | 'space'
  | 'editor'
  | 'kinds'
  | 'shortcuts'
  | 'mobile'
  | 'spelling'
  | 'markdown'
  | 'appearance'
  | 'experimental'
  | 'ai'
  | 'agents'
  | 'remote'
  | 'online'
  | 'account'
  | 'sync'
  | 'llm'
  | 'trash'
  | 'import'
  | 'export'

export interface SettingsSectionExtension {
  readonly id: SettingsSectionId
  readonly label: string
  readonly icon: string
}

export type SidebarPanelId =
  'tree' | 'outline' | 'search' | 'tasks' | 'chats' | 'time' | 'links' | 'ask'

export type PanelSide = 'left' | 'right'

export interface SidebarPanelExtension {
  readonly id: SidebarPanelId
  readonly side: PanelSide
  readonly label: string
}

export type NewKind = 'note' | 'canvas' | 'pages' | 'web' | 'chat' | 'database'

export interface ShellExtensions {
  readonly tabKinds: readonly TabKindExtension[]
  readonly commands: readonly CommandExtension[]
  readonly settingsSections: readonly SettingsSectionExtension[]
  readonly sidebarPanels: readonly SidebarPanelExtension[]
}

export interface ShellRegistry {
  tabKind(extension: TabKindExtension): Result<void>
  command(extension: CommandExtension): Result<void>
  settingsSection(extension: SettingsSectionExtension): Result<void>
  sidebarPanel(extension: SidebarPanelExtension): Result<void>
}

export const EMPTY_EXTENSIONS: ShellExtensions = {
  tabKinds: [],
  commands: [],
  settingsSections: [],
  sidebarPanels: [],
}
