import type { FieldRole } from './channel'

export function roleWord(role: FieldRole): string {
  switch (role) {
    case 'username':
      return 'Username'
    case 'email':
      return 'Email'
    case 'password':
      return 'Password'
    case 'new-password':
      return 'New password'
    case 'totp':
      return '2FA code'
    case 'cc-name':
      return 'Name on card'
    case 'cc-number':
      return 'Card number'
    case 'cc-exp':
      return 'Expiry date'
    case 'cc-exp-month':
      return 'Expiry month'
    case 'cc-exp-year':
      return 'Expiry year'
    case 'cc-csc':
      return 'Security code'
    case 'given-name':
      return 'First name'
    case 'additional-name':
      return 'Middle name'
    case 'family-name':
      return 'Last name'
    case 'name':
      return 'Full name'
    case 'tel':
      return 'Phone'
    case 'street-address':
      return 'Street'
    case 'address-line2':
      return 'Floor or apartment'
    case 'postal-code':
      return 'ZIP or postal code'
    case 'address-level2':
      return 'City'
    case 'address-level1':
      return 'State or province'
    case 'country':
      return 'Country'
    case 'organization':
      return 'Organization'
    case 'bday':
      return 'Birthdate'
    case 'unknown':
      return 'Other'
  }
}
