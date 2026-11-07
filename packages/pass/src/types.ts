export const ITEM_KINDS = [
  'login',
  'alias',
  'card',
  'note',
  'identity',
  'custom',
  'ssh',
  'wifi',
] as const

export type ItemKind = (typeof ITEM_KINDS)[number]

export const FIELD_KINDS = ['text', 'hidden', 'totp', 'date'] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

export interface Field {
  id: string
  name: string
  kind: FieldKind
  value: string
}

export interface Section {
  id: string
  name: string
  fields: Field[]
}

export const MATCH_RULES = ['domain', 'host', 'exact', 'prefix', 'never'] as const

export type MatchRule = (typeof MATCH_RULES)[number]

export interface Website {
  url: string
  match: MatchRule
}

export interface Passkey {
  id: string
  rpId: string
  rpName: string
  userName: string
  userDisplayName: string
  userHandle: string
  credentialId: string
  privateKey: string
  algorithm: number
  counter: number
  created: number
  note: string
}

interface Common {
  title: string
  note: string
  fields: Field[]
}

export interface Login extends Common {
  kind: 'login'
  email: string
  username: string
  password: string
  totp: string
  websites: Website[]
  passkeys: Passkey[]
}

export const ALIAS_PROVIDERS = ['simplelogin', 'addy', 'manual'] as const

export type AliasProvider = (typeof ALIAS_PROVIDERS)[number]

export interface Alias extends Common {
  kind: 'alias'
  address: string
  provider: AliasProvider
  remoteId: string
  enabled: boolean
  mailboxes: string[]
  name: string
}

export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'other'] as const

export type CardBrand = (typeof CARD_BRANDS)[number]

export interface Card extends Common {
  kind: 'card'
  holder: string
  brand: CardBrand
  number: string
  expiry: string
  code: string
  pin: string
}

export interface Note extends Common {
  kind: 'note'
}

export const IDENTITY_FIELDS = {
  personal: [
    'fullName',
    'email',
    'phone',
    'firstName',
    'middleName',
    'lastName',
    'birthdate',
    'gender',
  ],
  address: ['organization', 'street', 'floor', 'zip', 'city', 'state', 'country', 'county'],
  contact: [
    'ssn',
    'passport',
    'license',
    'website',
    'x',
    'secondPhone',
    'linkedin',
    'reddit',
    'facebook',
    'yahoo',
    'instagram',
  ],
  work: ['company', 'jobTitle', 'personalWebsite', 'workPhone', 'workEmail'],
} as const

export type IdentityGroup = keyof typeof IDENTITY_FIELDS

export type IdentityKey = (typeof IDENTITY_FIELDS)[IdentityGroup][number]

export interface Identity extends Common {
  kind: 'identity'
  values: Partial<Record<IdentityKey, string>>
  sections: Section[]
}

export interface Custom extends Common {
  kind: 'custom'
  template: string
  mark?: string | undefined
  sections: Section[]
}

export interface SshKey extends Common {
  kind: 'ssh'
  privateKey: string
  publicKey: string
  sections: Section[]
}

export const WIFI_SECURITY = ['wpa', 'wpa2', 'wpa3', 'wep', 'none'] as const

export type WifiSecurity = (typeof WIFI_SECURITY)[number]

export interface Wifi extends Common {
  kind: 'wifi'
  ssid: string
  password: string
  security: WifiSecurity
  sections: Section[]
}

export type Content = Login | Alias | Card | Note | Identity | Custom | SshKey | Wifi

export type ContentOf<K extends ItemKind> = Extract<Content, { kind: K }>

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  key: string
}

export interface Envelope {
  v: 1
  content: Content
  folder: string | null
  trashed: number | null
  pinned: boolean
  monitored: boolean
  attachments: Attachment[]
  created: number
  modified: number
  used: number | null
}

export interface Item extends Envelope {
  id: string
  vault: string
  rev: number
}

export const VAULT_COLORS = [
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'blue',
  'grey',
] as const

export type VaultColor = (typeof VAULT_COLORS)[number]

export const VAULT_ICONS = [
  'home',
  'work',
  'money',
  'heart',
  'star',
  'shield',
  'key',
  'cart',
  'game',
  'travel',
  'school',
  'code',
  'family',
  'pet',
  'music',
  'book',
  'gift',
  'health',
  'car',
  'cloud',
] as const

export type VaultIcon = (typeof VAULT_ICONS)[number]

export interface Folder {
  id: string
  name: string
  parent: string | null
  mark?: string | undefined
}

export interface VaultMeta {
  v: 1
  name: string
  description: string
  color: VaultColor
  icon: VaultIcon
  mark?: string | undefined
  folders: Folder[]
  hidePasswordsFromViewers: boolean
}

export const ROLES = ['viewer', 'editor', 'manager', 'owner'] as const

export type Role = (typeof ROLES)[number]

export interface Vault extends VaultMeta {
  id: string
  rev: number
  role: Role
  members: number
  shared: boolean
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, manager: 2, owner: 3 }

export function atLeast(role: Role, wanted: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[wanted]
}
