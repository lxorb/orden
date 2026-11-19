import type { Separator } from '@orden/pass/generate'
import type { CardBrand, FieldKind, IdentityGroup, IdentityKey, MatchRule, WifiSecurity } from '@orden/pass/types'

export const IDENTITY_FIRST: Record<IdentityGroup, readonly IdentityKey[]> = {
  personal: ['fullName', 'email', 'phone'],
  address: ['organization', 'street', 'zip', 'city', 'state', 'country'],
  contact: ['ssn', 'passport', 'license', 'website', 'x', 'secondPhone'],
  work: ['company', 'jobTitle'],
}

export function fieldKindLabel(kind: FieldKind): string {
  return { text: 'Text', hidden: 'Hidden', totp: '2FA code', date: 'Date' }[kind]
}

export function matchLabel(rule: MatchRule): string {
  return {
    domain: 'Site and its subdomains',
    host: 'Exact host',
    exact: 'Exact address',
    prefix: 'Starts with',
    never: 'Never',
  }[rule]
}

export function securityLabel(security: WifiSecurity): string {
  return { wpa: 'WPA', wpa2: 'WPA2', wpa3: 'WPA3', wep: 'WEP', none: 'None' }[security]
}

export function brandLabel(brand: CardBrand): string {
  return {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    other: 'Other',
  }[brand]
}

export function brandOf(number: string): CardBrand | null {
  const digits = number.replace(/\D/g, '')
  if (digits === '') return null
  if (digits.startsWith('4')) return 'visa'
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^6(011|5|4[4-9])/.test(digits)) return 'discover'
  return 'other'
}

export function separatorLabel(separator: Separator | 'none'): string {
  return {
    none: 'None',
    hyphen: 'Hyphens',
    space: 'Spaces',
    period: 'Periods',
    comma: 'Commas',
    underscore: 'Underscores',
    digit: 'Numbers',
    digitOrSymbol: 'Numbers and symbols',
  }[separator]
}
