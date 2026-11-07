import type { Separator } from '@orden/pass/generate'
import type {
  CardBrand,
  FieldKind,
  IdentityGroup,
  IdentityKey,
  MatchRule,
  WifiSecurity,
} from '@orden/pass/types'
import { t } from '../i18n.svelte'

export const IDENTITY_FIRST: Record<IdentityGroup, readonly IdentityKey[]> = {
  personal: ['fullName', 'email', 'phone'],
  address: ['organization', 'street', 'zip', 'city', 'state', 'country'],
  contact: ['ssn', 'passport', 'license', 'website', 'x', 'secondPhone'],
  work: ['company', 'jobTitle'],
}

export function fieldKindLabel(kind: FieldKind): string {
  switch (kind) {
    case 'text':
      return t('Text')
    case 'hidden':
      return t('Hidden')
    case 'totp':
      return t('2FA code')
    case 'date':
      return t('Date')
  }
}

export function matchLabel(rule: MatchRule): string {
  switch (rule) {
    case 'domain':
      return t('Site and its subdomains')
    case 'host':
      return t('Exact host')
    case 'exact':
      return t('Exact address')
    case 'prefix':
      return t('Starts with')
    case 'never':
      return t('Never')
  }
}

export function securityLabel(security: WifiSecurity): string {
  switch (security) {
    case 'wpa':
      return 'WPA'
    case 'wpa2':
      return 'WPA2'
    case 'wpa3':
      return 'WPA3'
    case 'wep':
      return 'WEP'
    case 'none':
      return t('None')
  }
}

export function brandLabel(brand: CardBrand): string {
  switch (brand) {
    case 'visa':
      return 'Visa'
    case 'mastercard':
      return 'Mastercard'
    case 'amex':
      return 'American Express'
    case 'discover':
      return 'Discover'
    case 'other':
      return t('Other')
  }
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
  switch (separator) {
    case 'none':
      return t('None')
    case 'hyphen':
      return t('Hyphens')
    case 'space':
      return t('Spaces')
    case 'period':
      return t('Periods')
    case 'comma':
      return t('Commas')
    case 'underscore':
      return t('Underscores')
    case 'digit':
      return t('Numbers')
    case 'digitOrSymbol':
      return t('Numbers and symbols')
  }
}
