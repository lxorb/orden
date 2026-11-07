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
import { t } from '../i18n.svelte'
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
    [() => t('API key'), hidden],
    [() => t('Secret'), hidden],
    [() => t('Expiry date'), date],
    [() => t('Permissions'), text],
  ],
  database: [
    [() => t('Host'), text],
    [() => t('Port'), text],
    [() => t('Username'), text],
    [() => t('Password'), hidden],
    [() => t('Database type'), text],
  ],
  server: [
    [() => t('IP address'), text],
    [() => t('Hostname'), text],
    [() => t('Operating system'), text],
    [() => t('Username'), text],
    [() => t('Password'), hidden],
  ],
  license: [
    [() => t('License key'), hidden],
    [() => t('Licensed to'), text],
    [() => t('Email'), text],
    [() => t('Expiry date'), date],
  ],
  bank: [
    [() => t('Bank name'), text],
    [() => t('Account holder'), text],
    [() => t('Account number'), hidden],
    [() => t('Routing number'), hidden],
    [() => t('IBAN'), hidden],
    [() => t('SWIFT or BIC'), text],
    [() => t('PIN'), hidden],
  ],
  crypto: [
    [() => t('Wallet name'), text],
    [() => t('Address'), text],
    [() => t('Private key'), hidden],
    [() => t('Recovery phrase'), hidden],
    [() => t('Network'), text],
  ],
  driver: [
    [() => t('Full name'), text],
    [() => t('License number'), hidden],
    [() => t('Issued by'), text],
    [() => t('Class'), text],
    [() => t('Date of birth'), date],
    [() => t('Expiry date'), date],
  ],
  medical: [
    [() => t('Patient'), text],
    [() => t('Record number'), hidden],
    [() => t('Doctor'), text],
    [() => t('Conditions'), text],
    [() => t('Medications'), text],
    [() => t('Allergies'), text],
  ],
  membership: [
    [() => t('Organization'), text],
    [() => t('Member name'), text],
    [() => t('Membership number'), hidden],
    [() => t('Level'), text],
    [() => t('Expiry date'), date],
  ],
  passport: [
    [() => t('Full name'), text],
    [() => t('Passport number'), hidden],
    [() => t('Country'), text],
    [() => t('Date of birth'), date],
    [() => t('Place of birth'), text],
    [() => t('Issue date'), date],
    [() => t('Expiry date'), date],
  ],
  reward: [
    [() => t('Program'), text],
    [() => t('Member number'), hidden],
    [() => t('Level'), text],
    [() => t('Points'), text],
    [() => t('Expiry date'), date],
  ],
  ssn: [
    [() => t('Full name'), text],
    [() => t('Social security number'), hidden],
  ],
}

export interface Template {
  id: TemplateId
  label: () => string
  icon: IconNode
}

export const TEMPLATES: readonly Template[] = [
  { id: 'ssh', label: () => t('SSH key'), icon: KeySquare },
  { id: 'wifi', label: () => t('WiFi network'), icon: Wifi },
  { id: 'api', label: () => t('API credential'), icon: FileKey },
  { id: 'database', label: () => t('Database'), icon: Database },
  { id: 'server', label: () => t('Server'), icon: Server },
  { id: 'license', label: () => t('Software license'), icon: FileBadge },
  { id: 'bank', label: () => t('Bank account'), icon: Landmark },
  { id: 'crypto', label: () => t('Crypto wallet'), icon: Bitcoin },
  { id: 'driver', label: () => t('Driver license'), icon: CarFront },
  { id: 'medical', label: () => t('Medical record'), icon: Stethoscope },
  { id: 'membership', label: () => t('Membership'), icon: IdCardLanyard },
  { id: 'passport', label: () => t('Passport'), icon: BookUser },
  { id: 'reward', label: () => t('Reward program'), icon: Award },
  { id: 'ssn', label: () => t('Social security number'), icon: Contact },
  { id: 'scratch', label: () => t('Start from scratch'), icon: Shapes },
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
