import type { FieldKind } from '@orden/pass/types'
import type { IconNode } from 'lucide'
import AtSign from 'lucide/dist/esm/icons/at-sign.mjs'
import Calendar from 'lucide/dist/esm/icons/calendar.mjs'
import Clock from 'lucide/dist/esm/icons/clock.mjs'
import CreditCard from 'lucide/dist/esm/icons/credit-card.mjs'
import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Hash from 'lucide/dist/esm/icons/hash.mjs'
import Key from 'lucide/dist/esm/icons/key.mjs'
import KeySquare from 'lucide/dist/esm/icons/key-square.mjs'
import Lock from 'lucide/dist/esm/icons/lock.mjs'
import Mail from 'lucide/dist/esm/icons/mail.mjs'
import Type from 'lucide/dist/esm/icons/type.mjs'
import User from 'lucide/dist/esm/icons/user.mjs'
import Wifi from 'lucide/dist/esm/icons/wifi.mjs'

export const FIELD_ICONS = {
  email: Mail,
  username: User,
  totp: Clock,
  note: FileText,
  website: Globe,
  holder: User,
  number: CreditCard,
  expiry: Calendar,
  code: Lock,
  pin: Hash,
  alias: AtSign,
  name: User,
  network: Wifi,
  privateKey: KeySquare,
  publicKey: Key,
} satisfies Record<string, IconNode>

const KIND_FIELD_ICONS: Record<FieldKind, IconNode> = {
  text: Type,
  hidden: EyeOff,
  totp: Clock,
  date: Calendar,
}

export function fieldKindIcon(kind: FieldKind): IconNode {
  return KIND_FIELD_ICONS[kind]
}
