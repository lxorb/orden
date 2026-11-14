import type { Content, Field, Section } from '@orden/pass/types'
import { IDENTITY_FIELDS } from '@orden/pass/types'
import { HIDDEN_IDENTITY, identityFieldName, identityGroupName } from './identity-words'

interface ShownField {
  id: string
  label: string
  value: string
  kind: 'text' | 'hidden' | 'totp' | 'date'
  mono?: boolean
  strength?: boolean
  multiline?: boolean
}

export interface ShownGroup {
  id: string
  name: string
  fields: ShownField[]
}

function present(fields: ShownField[]): ShownField[] {
  return fields.filter((one) => one.value.trim() !== '')
}

function extraOf(field: Field): ShownField {
  return {
    id: field.id,
    label: field.name || 'Field',
    value: field.value,
    kind: field.kind,
    ...(field.kind === 'hidden' ? { mono: true } : {}),
  }
}

function sectionGroups(sections: readonly Section[]): ShownGroup[] {
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    fields: present(section.fields.map(extraOf)),
  }))
}

function mainOf(content: Content): ShownField[] {
  switch (content.kind) {
    case 'login':
      return [
        { id: 'email', label: 'Email', value: content.email, kind: 'text' },
        { id: 'username', label: 'Username', value: content.username, kind: 'text' },
        {
          id: 'password',
          label: 'Password',
          value: content.password,
          kind: 'hidden',
          strength: true,
        },
        { id: 'totp', label: '2FA code', value: content.totp, kind: 'totp' },
      ]
    case 'alias':
      return [{ id: 'address', label: 'Alias address', value: content.address, kind: 'text' }]
    case 'card':
      return [
        { id: 'holder', label: 'Name on card', value: content.holder, kind: 'text' },
        { id: 'number', label: 'Card number', value: content.number, kind: 'hidden' },
        { id: 'expiry', label: 'Expiration date', value: content.expiry, kind: 'text' },
        { id: 'code', label: 'Security code', value: content.code, kind: 'hidden' },
        { id: 'pin', label: 'PIN', value: content.pin, kind: 'hidden' },
      ]
    case 'ssh':
      return [
        {
          id: 'public',
          label: 'Public key',
          value: content.publicKey,
          kind: 'text',
          mono: true,
          multiline: true,
        },
        {
          id: 'private',
          label: 'Private key',
          value: content.privateKey,
          kind: 'hidden',
          multiline: true,
        },
      ]
    case 'wifi':
      return [
        { id: 'ssid', label: 'Network name', value: content.ssid, kind: 'text' },
        { id: 'password', label: 'Password', value: content.password, kind: 'hidden' },
      ]
    case 'note':
    case 'identity':
    case 'custom':
      return []
  }
}

function identityGroups(content: Content): ShownGroup[] {
  if (content.kind !== 'identity') return []
  return Object.entries(IDENTITY_FIELDS).map(([group, keys]) => ({
    id: group,
    name: identityGroupName(group as keyof typeof IDENTITY_FIELDS),
    fields: present(
      keys.map((key) => ({
        id: key,
        label: identityFieldName(key),
        value: content.values[key] ?? '',
        kind: HIDDEN_IDENTITY.has(key) ? 'hidden' : 'text',
      })),
    ),
  }))
}

export function groupsOf(content: Content): ShownGroup[] {
  const main: ShownGroup = { id: 'main', name: '', fields: present(mainOf(content)) }
  const sections =
    content.kind === 'identity' ||
    content.kind === 'custom' ||
    content.kind === 'ssh' ||
    content.kind === 'wifi'
      ? sectionGroups(content.sections)
      : []
  const extra: ShownGroup = { id: 'extra', name: '', fields: present(content.fields.map(extraOf)) }
  return [main, ...identityGroups(content), ...sections, extra].filter(
    (group) => group.fields.length > 0,
  )
}
