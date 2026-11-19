declare const brand: unique symbol

export type Branded<Raw, Name extends string> = Raw & { readonly [brand]: Name }

export type SpaceId = Branded<string, 'SpaceId'>
export type UserId = Branded<string, 'UserId'>
export type GuestId = Branded<string, 'GuestId'>
export type DeviceId = Branded<string, 'DeviceId'>
export type ItemId = Branded<string, 'ItemId'>
export type NoteId = Branded<string, 'NoteId'>
export type NotePath = Branded<string, 'NotePath'>
export type TabId = Branded<string, 'TabId'>
export type PaneId = Branded<string, 'PaneId'>
export type DocKey = Branded<string, 'DocKey'>
export type AgentId = Branded<string, 'AgentId'>
export type CommandId = Branded<string, 'CommandId'>
export type ThemeId = Branded<string, 'ThemeId'>
export type Ulid = Branded<string, 'Ulid'>

export const LONGEST_ID = 200

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID

export const isEntryId = (value: unknown): value is string =>
  isId(value) && !/[/\\\p{Cc}]/u.test(value) && !value.includes('..')

export const isUlid = (value: unknown): value is Ulid => typeof value === 'string' && ULID.test(value)

export const spaceId = (value: string): SpaceId | null => (isId(value) ? (value as SpaceId) : null)

export const userId = (value: string): UserId | null => (isId(value) ? (value as UserId) : null)

export const guestId = (value: string): GuestId | null => (isId(value) ? (value as GuestId) : null)

export const deviceId = (value: string): DeviceId | null => (isId(value) ? (value as DeviceId) : null)

export const itemId = (value: string): ItemId | null => (isEntryId(value) ? (value as ItemId) : null)

export const noteId = (value: string): NoteId | null => (isEntryId(value) ? (value as NoteId) : null)

export const tabId = (value: string): TabId | null => (isId(value) ? (value as TabId) : null)

export const paneId = (value: string): PaneId | null => (isId(value) ? (value as PaneId) : null)

export const docKey = (value: string): DocKey | null => (isId(value) ? (value as DocKey) : null)

export const agentId = (value: string): AgentId | null => (isId(value) ? (value as AgentId) : null)

export const commandId = (value: string): CommandId | null => (isId(value) ? (value as CommandId) : null)

export const themeId = (value: string): ThemeId | null => (isId(value) ? (value as ThemeId) : null)

export const notePath = (value: string): NotePath | null =>
  value.length > 0 && !value.includes('\0') ? (value as NotePath) : null
