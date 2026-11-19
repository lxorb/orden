import type { CommandExtension } from './shell'

export type SurfaceId =
  | 'agent-rows'
  | 'agent-session'
  | 'archive'
  | 'archived-strip'
  | 'ask'
  | 'canvas'
  | 'channel'
  | 'chat-links'
  | 'chats'
  | 'crash-ask'
  | 'explorer'
  | 'export'
  | 'find-bar'
  | 'graph'
  | 'host-picker'
  | 'import'
  | 'keys-moved'
  | 'links'
  | 'overview'
  | 'pages'
  | 'pages-navigator'
  | 'pass'
  | 'pass-fill'
  | 'phone-tabs'
  | 'phone-you'
  | 'private-mark'
  | 'publish'
  | 'quick-add'
  | 'quick-question'
  | 'reading'
  | 'recording-pill'
  | 'rewrite'
  | 'scratchpad-card'
  | 'search-panel'
  | 'settings'
  | 'spark'
  | 'takeover-bar'
  | 'tasks'
  | 'terminal'
  | 'terminal-mark'
  | 'time'
  | 'time-panel'
  | 'todos'
  | 'undo-toast'
  | 'view'
  | 'web'
export interface FindFlags {
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
}
export interface FindBarProps {
  query: string
  count: number
  current: number
  capped?: boolean
  slow?: boolean
  flags?: FindFlags | undefined
  onflags?: ((flags: FindFlags) => void) | undefined
  replacing?: boolean
  replacement?: string
  onreplacing?: ((open: boolean) => void) | undefined
  onreplacement?: ((typed: string) => void) | undefined
  onreplace?: (() => void) | undefined
  onreplaceall?: (() => void) | undefined
  onstep: (by: number) => void
  onselectall?: (() => void) | undefined
  onclose: () => void
  onquery: (typed: string) => void
}
export const OUTSIDE_FOLDER = 'orden:outside-folder'
export type SheetId =
  | 'export'
  | 'host-picker'
  | 'import'
  | 'overview'
  | 'publish'
  | 'quick-question'
  | 'recording-pill'
  | 'rewrite'
  | 'space-picker'
  | 'space-sound'
  | 'sync-mark'
  | 'undo-toast'
export interface SheetsPort {
  ask(id: SheetId): Promise<void>
}
export interface QuickAddPrefill {
  text?: string
  description?: string
  tags?: string[]
  due?: string
  fields?: { priority?: 1 | 2 | 3 | 4 | 5 | 6 }
}
export interface QuickAddPort {
  show(prefill?: QuickAddPrefill): void
}
export interface NoticePort {
  say(words: string): void
}
export interface ShellFocusPort {
  editor(): boolean
}
export interface AppCommandsPort {
  rows(view: object | undefined): Promise<readonly CommandExtension[]>
}
export interface SurfacePorts {
  readonly 'commands.app': AppCommandsPort
  readonly search: SearchPort
  readonly 'shell.focus': ShellFocusPort
  readonly 'shell.notice': NoticePort
  readonly 'shell.sheets': SheetsPort
  readonly 'quick-add.show': QuickAddPort
}
const loads = new Map<SurfaceId, () => Promise<unknown>>()
let missing = (id: SurfaceId): Promise<unknown> =>
  Promise.reject(new Error(`no module has registered the surface '${id}'`))
export function whenNoSurface(load: (id: SurfaceId) => Promise<unknown>) {
  missing = load
}
export function registerSurfaces(given: Partial<Record<SurfaceId, () => Promise<unknown>>>): () => void {
  const held = Object.entries(given) as [SurfaceId, () => Promise<unknown>][]
  for (const [id, load] of held) loads.set(id, load)
  return () => {
    for (const [id, load] of held) if (loads.get(id) === load) loads.delete(id)
  }
}
export function surfaceLoad(id: SurfaceId): Promise<unknown> {
  const load = loads.get(id)
  return load ? load() : missing(id)
}
export interface SearchHit {
  path: string
  name: string
  line: number
  page?: number
  tab?: string
  text: string
  ranges: { from: number; to: number }[]
  bare?: true
  score?: number
}
export type SearchSort = 'relevance' | 'name' | 'modified' | 'created'
export interface SearchOrdering {
  sort: SearchSort
  descending: boolean
}
export interface SearchPanel {
  readonly running: boolean
  readonly hits: readonly SearchHit[]
  readonly ordering: SearchOrdering
  ask(text: string): void
  setSort(sort: SearchSort): void
}
export interface SearchPort {
  readonly panel: SearchPanel
  show(text: string): void
  fromView(view: object | undefined): void
}
