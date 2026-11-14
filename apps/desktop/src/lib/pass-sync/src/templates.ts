import { blank } from '@orden/pass/envelope'
import type { Content, Field, FieldKind, Section } from '@orden/pass/types'
import type { IconNode } from 'lucide'
import Award from 'lucide/dist/esm/icons/award.mjs'
import Bitcoin from 'lucide/dist/esm/icons/bitcoin.mjs'
import CarFront from 'lucide/dist/esm/icons/car-front.mjs'
import Database from 'lucide/dist/esm/icons/database.mjs'
import FileBadge from 'lucide/dist/esm/icons/file-badge.mjs'
import FileKey from 'lucide/dist/esm/icons/file-key.mjs'
import IdCardLanyard from 'lucide/dist/esm/icons/id-card-lanyard.mjs'
import KeySquare from 'lucide/dist/esm/icons/key-square.mjs'
import Landmark from 'lucide/dist/esm/icons/landmark.mjs'
import BookUser from 'lucide/dist/esm/icons/book-user.mjs'
import Server from 'lucide/dist/esm/icons/server.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
import Stethoscope from 'lucide/dist/esm/icons/stethoscope.mjs'
import Wifi from 'lucide/dist/esm/icons/wifi.mjs'
import Contact from 'lucide/dist/esm/icons/contact.mjs'
import { newId } from './rows'

export type TemplateId =
  | 'ssh'
  | 'wifi'
  | 'api'
  | 'database'
  | 'server'
  | 'license'
  | 'bank'
  | 'crypto'
  | 'driver'
  | 'medical'
  | 'membership'
  | 'passport'
  | 'reward'
  | 'ssn'
  | 'scratch'

type Spec = readonly (readonly [() => string, FieldKind])[]

const text = 'text' as const
const hidden = 'hidden' as const
const date = 'date' as const

const FIELDS: Record<Exclude<TemplateId, 'ssh' | 'wifi' | 'scratch'>, Spec> = {
  api: [
    [() => 'API key', hidden],
    [() => 'Secret', hidden],
    [() => 'Expiry date', date],
    [() => 'Permissions', text],
  ],
  database: [
    [() => 'Host', text],
    [() => 'Port', text],
    [() => 'Username', text],
    [() => 'Password', hidden],
    [() => 'Database type', text],
  ],
  server: [
    [() => 'IP address', text],
    [() => 'Hostname', text],
    [() => 'Operating system', text],
    [() => 'Username', text],
    [() => 'Password', hidden],
  ],
  license: [
    [() => 'License key', hidden],
    [() => 'Licensed to', text],
    [() => 'Email', text],
    [() => 'Expiry date', date],
  ],
  bank: [
    [() => 'Bank name', text],
    [() => 'Account holder', text],
    [() => 'Account number', hidden],
    [() => 'Routing number', hidden],
    [() => 'IBAN', hidden],
    [() => 'SWIFT or BIC', text],
    [() => 'PIN', hidden],
  ],
  crypto: [
    [() => 'Wallet name', text],
    [() => 'Address', text],
    [() => 'Private key', hidden],
    [() => 'Recovery phrase', hidden],
    [() => 'Network', text],
  ],
  driver: [
    [() => 'Full name', text],
    [() => 'License number', hidden],
    [() => 'Issued by', text],
    [() => 'Class', text],
    [() => 'Date of birth', date],
    [() => 'Expiry date', date],
  ],
  medical: [
    [() => 'Patient', text],
    [() => 'Record number', hidden],
    [() => 'Doctor', text],
    [() => 'Conditions', text],
    [() => 'Medications', text],
    [() => 'Allergies', text],
  ],
  membership: [
    [() => 'Organization', text],
    [() => 'Member name', text],
    [() => 'Membership number', hidden],
    [() => 'Level', text],
    [() => 'Expiry date', date],
  ],
  passport: [
    [() => 'Full name', text],
    [() => 'Passport number', hidden],
    [() => 'Country', text],
    [() => 'Date of birth', date],
    [() => 'Place of birth', text],
    [() => 'Issue date', date],
    [() => 'Expiry date', date],
  ],
  reward: [
    [() => 'Program', text],
    [() => 'Member number', hidden],
    [() => 'Level', text],
    [() => 'Points', text],
    [() => 'Expiry date', date],
  ],
  ssn: [
    [() => 'Full name', text],
    [() => 'Social security number', hidden],
  ],
}

export interface Template {
  id: TemplateId
  label: () => string
  icon: IconNode
}

export const TEMPLATES: readonly Template[] = [
  { id: 'ssh', label: () => 'SSH key', icon: KeySquare },
  { id: 'wifi', label: () => 'WiFi network', icon: Wifi },
  { id: 'api', label: () => 'API credential', icon: FileKey },
  { id: 'database', label: () => 'Database', icon: Database },
  { id: 'server', label: () => 'Server', icon: Server },
  { id: 'license', label: () => 'Software license', icon: FileBadge },
  { id: 'bank', label: () => 'Bank account', icon: Landmark },
  { id: 'crypto', label: () => 'Crypto wallet', icon: Bitcoin },
  { id: 'driver', label: () => 'Driver license', icon: CarFront },
  { id: 'medical', label: () => 'Medical record', icon: Stethoscope },
  { id: 'membership', label: () => 'Membership', icon: IdCardLanyard },
  { id: 'passport', label: () => 'Passport', icon: BookUser },
  { id: 'reward', label: () => 'Reward program', icon: Award },
  { id: 'ssn', label: () => 'Social security number', icon: Contact },
  { id: 'scratch', label: () => 'Start from scratch', icon: Shapes },
]

function fieldsOf(spec: Spec): Field[] {
  return spec.map(([name, kind]) => ({ id: newId(), name: name(), kind, value: '' }))
}

export function newSection(name: string, fields: Field[] = []): Section {
  return { id: newId(), name, fields }
}

export function contentFromTemplate(id: TemplateId): Content {
  switch (id) {
    case 'ssh':
      return blank('ssh')
    case 'wifi':
      return blank('wifi')
    case 'scratch':
      return blank('custom')
    case 'api':
    case 'database':
    case 'server':
    case 'license':
    case 'bank':
    case 'crypto':
    case 'driver':
    case 'medical':
    case 'membership':
    case 'passport':
    case 'reward':
    case 'ssn':
      return { ...blank('custom'), template: id, sections: [newSection('', fieldsOf(FIELDS[id]))] }
  }
}
