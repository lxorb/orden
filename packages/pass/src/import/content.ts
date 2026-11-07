import { blank } from '../envelope'
import type { Custom, Field, Passkey, Section, SshKey, Wifi, WifiSecurity } from '../types'

const WIFI_ORDER: readonly WifiSecurity[] = ['wpa3', 'wpa2', 'wpa', 'wep']

export interface CustomParts {
  title: string
  note?: string
  template?: string
  sections?: Section[]
  fields?: Field[]
}

function nonEmpty(sections: readonly Section[]): Section[] {
  return sections.filter((section) => section.fields.length > 0)
}

export function customOf(parts: CustomParts): Custom {
  return {
    ...blank('custom'),
    title: parts.title.trim(),
    note: parts.note ?? '',
    template: parts.template ?? '',
    sections: nonEmpty(parts.sections ?? []),
    fields: parts.fields ?? [],
  }
}

export interface SshParts {
  title: string
  note?: string
  privateKey: string
  publicKey: string
  sections?: Section[]
  fields?: Field[]
}

export function sshOf(parts: SshParts): SshKey {
  return {
    ...blank('ssh'),
    title: parts.title.trim(),
    note: parts.note ?? '',
    privateKey: parts.privateKey,
    publicKey: parts.publicKey.trim(),
    sections: nonEmpty(parts.sections ?? []),
    fields: parts.fields ?? [],
  }
}

export interface WifiParts {
  title: string
  note?: string
  ssid: string
  password: string
  security: string
  sections?: Section[]
  fields?: Field[]
}

export function wifiSecurityOf(text: string): WifiSecurity {
  const word = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (word === '' || word === 'open' || word === 'nopassword') return 'none'
  return WIFI_ORDER.find((one) => word.includes(one)) ?? 'wpa2'
}

export function wifiOf(parts: WifiParts): Wifi {
  return {
    ...blank('wifi'),
    title: parts.title.trim(),
    note: parts.note ?? '',
    ssid: parts.ssid.trim(),
    password: parts.password,
    security: wifiSecurityOf(parts.security),
    sections: nonEmpty(parts.sections ?? []),
    fields: parts.fields ?? [],
  }
}

export interface PasskeyParts {
  rpId: string
  rpName?: string
  userName?: string
  userDisplayName?: string
  userHandle?: string
  credentialId: string
  privateKey: string
  algorithm?: number
  counter?: number
  created?: number | null
  note?: string
}

export function passkeyOf(parts: PasskeyParts): Passkey {
  return {
    id: globalThis.crypto.randomUUID(),
    rpId: parts.rpId,
    rpName: parts.rpName ?? parts.rpId,
    userName: parts.userName ?? '',
    userDisplayName: parts.userDisplayName ?? '',
    userHandle: parts.userHandle ?? '',
    credentialId: parts.credentialId,
    privateKey: parts.privateKey,
    algorithm: parts.algorithm ?? -7,
    counter: parts.counter ?? 0,
    created: parts.created ?? 0,
    note: parts.note ?? '',
  }
}

export function dayOf(ms: number | null): string {
  if (ms === null) return ''
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

export function folderPaths(
  folders: readonly { id: string; name: string; parent: string | null }[],
): Map<string, string> {
  const byId = new Map(folders.map((one) => [one.id, one]))
  const paths = new Map<string, string>()
  const pathOf = (id: string, seen: Set<string>): string => {
    const known = paths.get(id)
    if (known !== undefined) return known
    const folder = byId.get(id)
    if (!folder) return ''
    seen.add(id)
    const parent =
      folder.parent !== null && byId.has(folder.parent) && !seen.has(folder.parent)
        ? pathOf(folder.parent, seen)
        : ''
    const path = parent === '' ? folder.name.trim() : `${parent}/${folder.name.trim()}`
    paths.set(id, path)
    return path
  }
  for (const folder of folders) pathOf(folder.id, new Set())
  return paths
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

export function monthNumberOf(text: string): string {
  const word = text.trim().toLowerCase()
  if (/^\d{1,2}$/.test(word)) return word
  if (word.length < 3) return ''
  const at = MONTHS.findIndex((month) => month.startsWith(word))
  return at < 0 ? '' : String(at + 1)
}
