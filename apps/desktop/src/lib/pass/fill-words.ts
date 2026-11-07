import { t } from '../i18n.svelte'
import type { FieldRole } from './channel'

export function roleWord(role: FieldRole): string {
  switch (role) {
    case 'username':
      return t('Username')
    case 'email':
      return t('Email')
    case 'password':
      return t('Password')
    case 'new-password':
      return t('New password')
    case 'totp':
      return t('2FA code')
    case 'cc-name':
      return t('Name on card')
    case 'cc-number':
      return t('Card number')
    case 'cc-exp':
      return t('Expiry date')
    case 'cc-exp-month':
      return t('Expiry month')
    case 'cc-exp-year':
      return t('Expiry year')
    case 'cc-csc':
      return t('Security code')
    case 'given-name':
      return t('First name')
    case 'additional-name':
      return t('Middle name')
    case 'family-name':
      return t('Last name')
    case 'name':
      return t('Full name')
    case 'tel':
      return t('Phone')
    case 'street-address':
      return t('Street')
    case 'address-line2':
      return t('Floor or apartment')
    case 'postal-code':
      return t('ZIP or postal code')
    case 'address-level2':
      return t('City')
    case 'address-level1':
      return t('State or province')
    case 'country':
      return t('Country')
    case 'organization':
      return t('Organization')
    case 'bday':
      return t('Birthdate')
    case 'unknown':
      return t('Other')
  }
}
