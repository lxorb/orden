import type { IdentityGroup, IdentityKey } from '@orden/pass/types'

export function identityGroupName(group: IdentityGroup): string {
  switch (group) {
    case 'personal':
      return 'Personal details'
    case 'address':
      return 'Address details'
    case 'contact':
      return 'Contact details'
    case 'work':
      return 'Work details'
  }
}

const NAMES: Record<IdentityKey, () => string> = {
  fullName: () => 'Full name',
  email: () => 'Email',
  phone: () => 'Phone number',
  firstName: () => 'First name',
  middleName: () => 'Middle name',
  lastName: () => 'Last name',
  birthdate: () => 'Birthdate',
  gender: () => 'Gender',
  organization: () => 'Organization',
  street: () => 'Street address',
  floor: () => 'Floor',
  zip: () => 'ZIP or postal code',
  city: () => 'City',
  state: () => 'State or province',
  country: () => 'Country or region',
  county: () => 'County',
  ssn: () => 'Social security number',
  passport: () => 'Passport number',
  license: () => 'License number',
  website: () => 'Website',
  x: () => 'X handle',
  secondPhone: () => 'Second phone number',
  linkedin: () => 'LinkedIn',
  reddit: () => 'Reddit',
  facebook: () => 'Facebook',
  yahoo: () => 'Yahoo',
  instagram: () => 'Instagram',
  company: () => 'Company',
  jobTitle: () => 'Job title',
  personalWebsite: () => 'Personal website',
  workPhone: () => 'Work phone number',
  workEmail: () => 'Work email',
}

export function identityFieldName(key: IdentityKey): string {
  return NAMES[key]()
}

export const HIDDEN_IDENTITY: ReadonlySet<IdentityKey> = new Set(['ssn', 'passport', 'license'])
