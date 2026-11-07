import type { Content, Field, ItemKind, Section } from '@orden/pass/types'
import { IDENTITY_FIELDS } from '@orden/pass/types'

type LinkFieldKind = 'text' | 'hidden' | 'totp' | 'long'

export interface LinkField {
  id: string
  name: string
  value: string
  kind: LinkFieldKind
}

export interface LinkGroup {
  id: string
  name: string
  fields: LinkField[]
}

const KINDS: Record<ItemKind, string> = {
  login: 'Login',
  alias: 'Alias',
  card: 'Card',
  note: 'Note',
  identity: 'Identity',
  custom: 'Item',
  ssh: 'SSH key',
  wifi: 'WiFi',
}

const GROUPS: Record<keyof typeof IDENTITY_FIELDS, string> = {
  personal: 'Personal details',
  address: 'Address details',
  contact: 'Contact details',
  work: 'Work details',
}

const HIDDEN_IDENTITY = new Set(['ssn', 'passport', 'license'])

export function kindName(kind: ItemKind): string {
  return KINDS[kind]
}

function spoken(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function field(id: string, name: string, value: string, kind: LinkFieldKind = 'text'): LinkField {
  return { id, name, value, kind }
}

function extra(one: Field): LinkField {
  const kind = one.kind === 'hidden' || one.kind === 'totp' ? one.kind : 'text'
  return field(one.id, one.name || 'Field', one.value, kind)
}

function mainOf(content: Content): LinkField[] {
  switch (content.kind) {
    case 'login':
      return [
        field('email', 'Email', content.email),
        field('username', 'Username', content.username),
        field('password', 'Password', content.password, 'hidden'),
        field('totp', '2FA code', content.totp, 'totp'),
      ]
    case 'alias':
      return [field('address', 'Alias address', content.address)]
    case 'card':
      return [
        field('holder', 'Name on card', content.holder),
        field('number', 'Card number', content.number, 'hidden'),
        field('expiry', 'Expiration date', content.expiry),
        field('code', 'Security code', content.code, 'hidden'),
        field('pin', 'PIN', content.pin, 'hidden'),
      ]
    case 'ssh':
      return [
        field('public', 'Public key', content.publicKey, 'long'),
        field('private', 'Private key', content.privateKey, 'hidden'),
      ]
    case 'wifi':
      return [
        field('ssid', 'Network name', content.ssid),
        field('password', 'Password', content.password, 'hidden'),
      ]
    case 'note':
    case 'identity':
    case 'custom':
      return []
  }
}

function identityOf(content: Content): LinkGroup[] {
  if (content.kind !== 'identity') return []
  return Object.entries(IDENTITY_FIELDS).map(([group, keys]) => ({
    id: group,
    name: GROUPS[group as keyof typeof IDENTITY_FIELDS],
    fields: keys.map((key) =>
      field(
        key,
        spoken(key),
        content.values[key] ?? '',
        HIDDEN_IDENTITY.has(key) ? 'hidden' : 'text',
      ),
    ),
  }))
}

function sectionsOf(content: Content): Section[] {
  switch (content.kind) {
    case 'identity':
    case 'custom':
    case 'ssh':
    case 'wifi':
      return content.sections
    case 'login':
    case 'alias':
    case 'card':
    case 'note':
      return []
  }
}

export function linkGroupsOf(content: Content): LinkGroup[] {
  const groups: LinkGroup[] = [
    { id: 'main', name: '', fields: mainOf(content) },
    ...identityOf(content),
    ...sectionsOf(content).map((one) => ({
      id: one.id,
      name: one.name,
      fields: one.fields.map(extra),
    })),
    { id: 'extra', name: '', fields: content.fields.map(extra) },
  ]
  return groups
    .map((group) => ({ ...group, fields: group.fields.filter((one) => one.value.trim() !== '') }))
    .filter((group) => group.fields.length > 0)
}

export function websitesOf(content: Content): string[] {
  return content.kind === 'login'
    ? content.websites.map((one) => one.url).filter((url) => url.trim() !== '')
    : []
}
