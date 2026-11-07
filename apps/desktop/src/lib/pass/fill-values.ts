import type { Card, Identity, IdentityKey, Login } from '@orden/pass/types'
import type { FieldRole, FormKind, PassForm } from './channel'

type RolePick = (role: FieldRole) => string | null

export interface LoginFill {
  login: Login
  code: string | null
  fresh: string | null
}

const IDENTITY: Partial<Record<FieldRole, readonly IdentityKey[]>> = {
  'given-name': ['firstName'],
  'additional-name': ['middleName'],
  'family-name': ['lastName'],
  name: ['fullName'],
  email: ['email', 'workEmail'],
  tel: ['phone', 'secondPhone', 'workPhone'],
  'street-address': ['street'],
  'address-line2': ['floor'],
  'postal-code': ['zip'],
  'address-level2': ['city'],
  'address-level1': ['state', 'county'],
  country: ['country'],
  organization: ['organization', 'company'],
  bday: ['birthdate'],
}

function valuesBy(form: PassForm, pick: RolePick): Record<string, string> {
  const values: Record<string, string> = {}
  for (const one of form.fields) {
    if (!one.visible) continue
    const value = pick(one.role)
    if (value) values[one.field] = value
  }
  return values
}

function firstOf(...texts: string[]): string | null {
  return texts.find((one) => one !== '') ?? null
}

function loginPick(kind: FormKind, given: LoginFill): RolePick {
  const { login, code, fresh } = given
  const by: Partial<Record<FieldRole, () => string | null>> = {
    username: () => firstOf(login.username, login.email),
    email: () => firstOf(login.email, login.username),
    password: () => firstOf(login.password),
    'new-password': () => fresh ?? (kind === 'signup' ? firstOf(login.password) : null),
    totp: () => code,
  }
  return (role) => by[role]?.() ?? null
}

export function loginValues(form: PassForm, given: LoginFill): Record<string, string> {
  return valuesBy(form, loginPick(form.kind, given))
}

export function aliasValues(form: PassForm, address: string): Record<string, string> {
  return valuesBy(form, (role) => (role === 'email' || role === 'username' ? address : null))
}

export function generatedValues(form: PassForm, fresh: string): Record<string, string> {
  return valuesBy(form, (role) => (role === 'new-password' ? fresh : null))
}

interface Expiry {
  month: string
  year: string
}

function expiryOf(text: string): Expiry | null {
  const trimmed = text.trim()
  const short = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(trimmed)
  if (short?.[1] && short[2]) {
    const year = short[2].length === 2 ? `20${short[2]}` : short[2]
    return { month: short[1].padStart(2, '0'), year }
  }
  const long = /^(\d{4})-(\d{1,2})$/.exec(trimmed)
  if (long?.[1] && long[2]) return { month: long[2].padStart(2, '0'), year: long[1] }
  return null
}

function cardPick(card: Card): RolePick {
  const expiry = expiryOf(card.expiry)
  const by: Partial<Record<FieldRole, () => string | null>> = {
    'cc-name': () => firstOf(card.holder),
    'cc-number': () => firstOf(card.number.replace(/[\s-]/g, '')),
    'cc-exp': () => (expiry ? `${expiry.month}/${expiry.year.slice(2)}` : firstOf(card.expiry)),
    'cc-exp-month': () => expiry?.month ?? null,
    'cc-exp-year': () => expiry?.year ?? null,
    'cc-csc': () => firstOf(card.code),
  }
  return (role) => by[role]?.() ?? null
}

export function cardValues(form: PassForm, card: Card): Record<string, string> {
  return valuesBy(form, cardPick(card))
}

function wholeName(identity: Identity): string {
  const { firstName, middleName, lastName } = identity.values
  return [firstName, middleName, lastName].filter(Boolean).join(' ')
}

function identityPick(identity: Identity): RolePick {
  return (role) => {
    const keys = IDENTITY[role]
    if (!keys) return null
    const found = keys.map((key) => identity.values[key] ?? '').find((one) => one !== '')
    if (found) return found
    return role === 'name' ? firstOf(wholeName(identity)) : null
  }
}

export function identityValues(form: PassForm, identity: Identity): Record<string, string> {
  return valuesBy(form, identityPick(identity))
}
