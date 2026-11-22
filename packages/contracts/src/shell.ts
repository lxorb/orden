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
  | 'key'
  | 'time'
  | 'settings'
  | 'import'
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
  'explorer',
  'pass',
  'time',
  'settings',
  'import',
] as const
export type TabKind = (typeof TAB_KINDS)[number]
export const isTabKind = (value: unknown): value is TabKind =>
  typeof value === 'string' && (TAB_KINDS as readonly string[]).includes(value)
export interface CommandExtension {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  readonly also?: readonly string[]
  readonly byHand?: boolean
  readonly ownWindow?: boolean
  readonly checked?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly run: () => void
}
export type SettingsSectionId =
  | 'general'
  | 'space'
  | 'editor'
  | 'kinds'
  | 'shortcuts'
  | 'mobile'
  | 'appearance'
  | 'browser'
  | 'experimental'
  | 'ai'
  | 'agents'
  | 'terminal'
  | 'account'
  | 'sync'
  | 'llm'
  | 'trash'
  | 'archived'
  | 'import'
export type SidebarPanelId = 'tree' | 'outline' | 'search' | 'tasks' | 'chats' | 'time' | 'links' | 'ask'
export type PanelSide = 'left' | 'right'
