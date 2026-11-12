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

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID
}

export function isEntryId(value: unknown): value is string {
  return isId(value) && !/[/\\\p{Cc}]/u.test(value) && !value.includes('..')
}

export function isUlid(value: unknown): value is Ulid {
  return typeof value === 'string' && ULID.test(value)
}

export function spaceId(value: string): SpaceId | null {
  return isId(value) ? (value as SpaceId) : null
}

export function userId(value: string): UserId | null {
  return isId(value) ? (value as UserId) : null
}

export function guestId(value: string): GuestId | null {
  return isId(value) ? (value as GuestId) : null
}

export function deviceId(value: string): DeviceId | null {
  return isId(value) ? (value as DeviceId) : null
}

export function itemId(value: string): ItemId | null {
  return isEntryId(value) ? (value as ItemId) : null
}

export function noteId(value: string): NoteId | null {
  return isEntryId(value) ? (value as NoteId) : null
}

export function tabId(value: string): TabId | null {
  return isId(value) ? (value as TabId) : null
}

export function paneId(value: string): PaneId | null {
  return isId(value) ? (value as PaneId) : null
}

export function docKey(value: string): DocKey | null {
  return isId(value) ? (value as DocKey) : null
}

export function agentId(value: string): AgentId | null {
  return isId(value) ? (value as AgentId) : null
}

export function commandId(value: string): CommandId | null {
  return isId(value) ? (value as CommandId) : null
}

export function themeId(value: string): ThemeId | null {
  return isId(value) ? (value as ThemeId) : null
}

export function notePath(value: string): NotePath | null {
  return value.length > 0 && !value.includes('\0') ? (value as NotePath) : null
}
