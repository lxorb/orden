import type { DeviceId, ItemId, UserId } from './ids'

export type EntryKind = 'note' | 'canvas' | 'pages' | 'url' | 'term' | 'chat' | 'file' | 'folder'

export const ENTRY_KINDS: readonly EntryKind[] = [
  'note',
  'canvas',
  'pages',
  'url',
  'term',
  'chat',
  'file',
  'folder',
]

export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === 'string' && (ENTRY_KINDS as readonly string[]).includes(value)
}

export type ItemMeta = Readonly<Record<string, string>>

export type MetaPatch = Readonly<Record<string, string | null>>

export interface Item {
  readonly id: ItemId
  readonly kind: EntryKind
  readonly parent: ItemId | null
  readonly name: string
  readonly deleted: boolean
  readonly seq: number
  readonly hash: string
  readonly size: number
  readonly by: UserId | DeviceId
  readonly at: number
  readonly pos?: string
  readonly meta?: ItemMeta
}

export interface Entry {
  readonly name: string
  readonly path: string
  readonly is_dir: boolean
  readonly modified: number
  readonly created: number
  readonly children: readonly Entry[]
  readonly evicted?: boolean
  readonly unlisted?: boolean
  readonly paper?: boolean
}
