import type { IdentityGroup, IdentityKey } from '@orden/pass/types'
import { t } from '../i18n.svelte'

export function identityGroupName(group: IdentityGroup): string {
  switch (group) {
    case 'personal':
      return t('Personal details')
    case 'address':
      return t('Address details')
    case 'contact':
      return t('Contact details')
    case 'work':
      return t('Work details')
  }
}

const NAMES: Record<IdentityKey, () => string> = {
  fullName: () => t('Full name'),
  email: () => t('Email'),
  phone: () => t('Phone number'),
  firstName: () => t('First name'),
  middleName: () => t('Middle name'),
  lastName: () => t('Last name'),
  birthdate: () => t('Birthdate'),
  gender: () => t('Gender'),
  organization: () => t('Organization'),
  street: () => t('Street address'),
  floor: () => t('Floor'),
  zip: () => t('ZIP or postal code'),
  city: () => t('City'),
  state: () => t('State or province'),
  country: () => t('Country or region'),
  county: () => t('County'),
  ssn: () => t('Social security number'),
  passport: () => t('Passport number'),
  license: () => t('License number'),
  website: () => t('Website'),
  x: () => t('X handle'),
  secondPhone: () => t('Second phone number'),
  linkedin: () => t('LinkedIn'),
  reddit: () => t('Reddit'),
  facebook: () => t('Facebook'),
  yahoo: () => t('Yahoo'),
  instagram: () => t('Instagram'),
  company: () => t('Company'),
  jobTitle: () => t('Job title'),
  personalWebsite: () => t('Personal website'),
  workPhone: () => t('Work phone number'),
  workEmail: () => t('Work email'),
}

export function identityFieldName(key: IdentityKey): string {
  return NAMES[key]()
}

export const HIDDEN_IDENTITY: ReadonlySet<IdentityKey> = new Set(['ssn', 'passport', 'license'])
