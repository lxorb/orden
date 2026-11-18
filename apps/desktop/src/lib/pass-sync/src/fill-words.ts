import type { FieldRole } from './channel'

export function roleWord(role: FieldRole): string {
  return {
    username: 'Username',
    email: 'Email',
    password: 'Password',
    'new-password': 'New password',
    totp: '2FA code',
    'cc-name': 'Name on card',
    'cc-number': 'Card number',
    'cc-exp': 'Expiry date',
    'cc-exp-month': 'Expiry month',
    'cc-exp-year': 'Expiry year',
    'cc-csc': 'Security code',
    'given-name': 'First name',
    'additional-name': 'Middle name',
    'family-name': 'Last name',
    name: 'Full name',
    tel: 'Phone',
    'street-address': 'Street',
    'address-line2': 'Floor or apartment',
    'postal-code': 'ZIP or postal code',
    'address-level2': 'City',
    'address-level1': 'State or province',
    country: 'Country',
    organization: 'Organization',
    bday: 'Birthdate',
    unknown: 'Other',
  }[role]
}
