import type {
  Attachment,
  Content,
  ContentOf,
  Envelope,
  Field,
  Folder,
  IdentityKey,
  ItemKind,
  Passkey,
  Section,
  VaultMeta,
  Website,
} from './types'
import {
  ALIAS_PROVIDERS,
  CARD_BRANDS,
  FIELD_KINDS,
  IDENTITY_FIELDS,
  ITEM_KINDS,
  MATCH_RULES,
  VAULT_COLORS,
  VAULT_ICONS,
  WIFI_SECURITY,
} from './types'

type Raw = Record<string, unknown>

class Malformed extends Error {}

const IDENTITY_KEYS: readonly IdentityKey[] = Object.values(IDENTITY_FIELDS).flat()

function recordOf(value: unknown): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Malformed()
  return value as Raw
}

function textOf(raw: Raw, key: string, fallback = ''): string {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new Malformed()
  return value
}

function idOf(raw: Raw): string {
  const id = textOf(raw, 'id')
  if (id === '') throw new Malformed()
  return id
}

function numberOf(raw: Raw, key: string, fallback: number): number {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Malformed()
  return value
}

function flagOf(raw: Raw, key: string, fallback: boolean): boolean {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Malformed()
  return value
}

function textOrNullOf(raw: Raw, key: string): string | null {
  return raw[key] === null ? null : textOf(raw, key, '') || null
}

function numberOrNullOf(raw: Raw, key: string): number | null {
  return raw[key] === null || raw[key] === undefined ? null : numberOf(raw, key, 0)
}

function wordOf<T extends string>(
  raw: Raw,
  key: string,
  words: readonly T[],
  fallback: T,
  unknown: T = fallback,
): T {
  const value = textOf(raw, key, fallback)
  return (words as readonly string[]).includes(value) ? (value as T) : unknown
}

function listOf<T>(raw: Raw, key: string, each: (value: unknown) => T): T[] {
  const value = raw[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Malformed()
  return value.map(each)
}

function fieldOf(value: unknown): Field {
  const raw = recordOf(value)
  return {
    id: idOf(raw),
    name: textOf(raw, 'name'),
    kind: wordOf(raw, 'kind', FIELD_KINDS, 'text', 'hidden'),
    value: textOf(raw, 'value'),
  }
}

function sectionOf(value: unknown): Section {
  const raw = recordOf(value)
  return { id: idOf(raw), name: textOf(raw, 'name'), fields: listOf(raw, 'fields', fieldOf) }
}

function websiteOf(value: unknown): Website {
  const raw = recordOf(value)
  return { url: textOf(raw, 'url'), match: wordOf(raw, 'match', MATCH_RULES, 'domain') }
}

function passkeyOf(value: unknown): Passkey {
  const raw = recordOf(value)
  return {
    id: idOf(raw),
    rpId: textOf(raw, 'rpId'),
    rpName: textOf(raw, 'rpName'),
    userName: textOf(raw, 'userName'),
    userDisplayName: textOf(raw, 'userDisplayName'),
    userHandle: textOf(raw, 'userHandle'),
    credentialId: textOf(raw, 'credentialId'),
    privateKey: textOf(raw, 'privateKey'),
    algorithm: numberOf(raw, 'algorithm', -7),
    counter: numberOf(raw, 'counter', 0),
    created: numberOf(raw, 'created', 0),
    note: textOf(raw, 'note'),
  }
}

function mailboxOf(value: unknown): string {
  if (typeof value !== 'string') throw new Malformed()
  return value
}

function identityValuesOf(raw: Raw): Partial<Record<IdentityKey, string>> {
  const given = raw.values === undefined ? {} : recordOf(raw.values)
  const values: Partial<Record<IdentityKey, string>> = {}
  for (const key of IDENTITY_KEYS) if (given[key] !== undefined) values[key] = textOf(given, key)
  return values
}

function kindOf(raw: Raw): ItemKind {
  if (typeof raw.kind !== 'string') throw new Malformed()
  return wordOf(raw, 'kind', ITEM_KINDS, 'custom')
}

function contentOf(value: unknown): Content {
  const raw = recordOf(value)
  const common = {
    title: textOf(raw, 'title'),
    note: textOf(raw, 'note'),
    fields: listOf(raw, 'fields', fieldOf),
  }
  const kind = kindOf(raw)
  switch (kind) {
    case 'login':
      return {
        kind,
        ...common,
        email: textOf(raw, 'email'),
        username: textOf(raw, 'username'),
        password: textOf(raw, 'password'),
        totp: textOf(raw, 'totp'),
        websites: listOf(raw, 'websites', websiteOf),
        passkeys: listOf(raw, 'passkeys', passkeyOf),
      }
    case 'alias':
      return {
        kind,
        ...common,
        address: textOf(raw, 'address'),
        provider: wordOf(raw, 'provider', ALIAS_PROVIDERS, 'manual'),
        remoteId: textOf(raw, 'remoteId'),
        enabled: flagOf(raw, 'enabled', true),
        mailboxes: listOf(raw, 'mailboxes', mailboxOf),
        name: textOf(raw, 'name'),
      }
    case 'card':
      return {
        kind,
        ...common,
        holder: textOf(raw, 'holder'),
        brand: wordOf(raw, 'brand', CARD_BRANDS, 'other'),
        number: textOf(raw, 'number'),
        expiry: textOf(raw, 'expiry'),
        code: textOf(raw, 'code'),
        pin: textOf(raw, 'pin'),
      }
    case 'note':
      return { kind, ...common }
    case 'identity':
      return {
        kind,
        ...common,
        values: identityValuesOf(raw),
        sections: listOf(raw, 'sections', sectionOf),
      }
    case 'custom':
      return {
        kind,
        ...common,
        template: textOf(raw, 'template'),
        sections: listOf(raw, 'sections', sectionOf),
      }
    case 'ssh':
      return {
        kind,
        ...common,
        privateKey: textOf(raw, 'privateKey'),
        publicKey: textOf(raw, 'publicKey'),
        sections: listOf(raw, 'sections', sectionOf),
      }
    case 'wifi':
      return {
        kind,
        ...common,
        ssid: textOf(raw, 'ssid'),
        password: textOf(raw, 'password'),
        security: wordOf(raw, 'security', WIFI_SECURITY, 'wpa2'),
        sections: listOf(raw, 'sections', sectionOf),
      }
  }
}

function attachmentOf(value: unknown): Attachment {
  const raw = recordOf(value)
  return {
    id: idOf(raw),
    name: textOf(raw, 'name'),
    type: textOf(raw, 'type'),
    size: numberOf(raw, 'size', 0),
    key: textOf(raw, 'key'),
  }
}

function versionOf(raw: Raw): 1 {
  if (numberOf(raw, 'v', 1) !== 1) throw new Malformed()
  return 1
}

function envelopeOf(value: unknown): Envelope {
  const raw = recordOf(value)
  const created = numberOf(raw, 'created', 0)
  return {
    v: versionOf(raw),
    content: contentOf(raw.content),
    folder: textOrNullOf(raw, 'folder'),
    trashed: numberOrNullOf(raw, 'trashed'),
    pinned: flagOf(raw, 'pinned', false),
    monitored: flagOf(raw, 'monitored', true),
    attachments: listOf(raw, 'attachments', attachmentOf),
    created,
    modified: numberOf(raw, 'modified', created),
    used: numberOrNullOf(raw, 'used'),
  }
}

function folderOf(value: unknown): Folder {
  const raw = recordOf(value)
  return { id: idOf(raw), name: textOf(raw, 'name'), parent: textOrNullOf(raw, 'parent') }
}

function vaultMetaOf(value: unknown): VaultMeta {
  const raw = recordOf(value)
  return {
    v: versionOf(raw),
    name: textOf(raw, 'name'),
    description: textOf(raw, 'description'),
    color: wordOf(raw, 'color', VAULT_COLORS, 'purple'),
    icon: wordOf(raw, 'icon', VAULT_ICONS, 'home'),
    folders: listOf(raw, 'folders', folderOf),
    hidePasswordsFromViewers: flagOf(raw, 'hidePasswordsFromViewers', false),
  }
}

function orNull<T>(read: (value: unknown) => T, value: unknown): T | null {
  try {
    return read(value)
  } catch (error) {
    if (error instanceof Malformed) return null
    throw error
  }
}

export function contentIn(value: unknown): Content | null {
  return orNull(contentOf, value)
}

export function envelopeIn(value: unknown): Envelope | null {
  return orNull(envelopeOf, value)
}

export function vaultMetaIn(value: unknown): VaultMeta | null {
  return orNull(vaultMetaOf, value)
}

export function blank<K extends ItemKind>(kind: K): ContentOf<K> {
  return contentOf({ kind }) as ContentOf<K>
}

export function newEnvelope(content: Content, now: number): Envelope {
  return {
    v: 1,
    content,
    folder: null,
    trashed: null,
    pinned: false,
    monitored: true,
    attachments: [],
    created: now,
    modified: now,
    used: null,
  }
}
