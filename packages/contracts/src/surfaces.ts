export type SurfaceId =
  | 'agent-rows'
  | 'agent-session'
  | 'application'
  | 'archive'
  | 'archived-strip'
  | 'ask'
  | 'canvas'
  | 'channel'
  | 'chats'
  | 'crash-ask'
  | 'explorer'
  | 'export'
  | 'find-bar'
  | 'graph'
  | 'host-picker'
  | 'import'
  | 'keys-moved'
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

export interface SurfacePorts {
  readonly 'shell.sheets': SheetsPort
  readonly 'quick-add.show': QuickAddPort
}

const loads = new Map<SurfaceId, () => Promise<unknown>>()

export function registerSurfaces(
  given: Partial<Record<SurfaceId, () => Promise<unknown>>>,
): () => void {
  const held = Object.entries(given) as [SurfaceId, () => Promise<unknown>][]
  for (const [id, load] of held) loads.set(id, load)
  return () => {
    for (const [id, load] of held) if (loads.get(id) === load) loads.delete(id)
  }
}

export function surfaceLoad(id: SurfaceId): Promise<unknown> {
  const load = loads.get(id)
  return load ? load() : Promise.reject(new Error(`no module has registered the surface '${id}'`))
}
