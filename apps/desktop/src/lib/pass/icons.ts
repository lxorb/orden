import type { ItemKind, VaultColor, VaultIcon } from '@orden/pass/types'
import type { IconNode } from 'lucide'
import AtSign from 'lucide/dist/esm/icons/at-sign.mjs'
import Book from 'lucide/dist/esm/icons/book.mjs'
import Briefcase from 'lucide/dist/esm/icons/briefcase.mjs'
import Car from 'lucide/dist/esm/icons/car.mjs'
import Cloud from 'lucide/dist/esm/icons/cloud.mjs'
import Code from 'lucide/dist/esm/icons/code.mjs'
import CreditCard from 'lucide/dist/esm/icons/credit-card.mjs'
import Gamepad from 'lucide/dist/esm/icons/gamepad-2.mjs'
import Gift from 'lucide/dist/esm/icons/gift.mjs'
import GraduationCap from 'lucide/dist/esm/icons/graduation-cap.mjs'
import Heart from 'lucide/dist/esm/icons/heart.mjs'
import HeartPulse from 'lucide/dist/esm/icons/heart-pulse.mjs'
import House from 'lucide/dist/esm/icons/house.mjs'
import IdCard from 'lucide/dist/esm/icons/id-card.mjs'
import Key from 'lucide/dist/esm/icons/key.mjs'
import KeySquare from 'lucide/dist/esm/icons/key-square.mjs'
import Music from 'lucide/dist/esm/icons/music.mjs'
import PawPrint from 'lucide/dist/esm/icons/paw-print.mjs'
import Plane from 'lucide/dist/esm/icons/plane.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
import Shield from 'lucide/dist/esm/icons/shield.mjs'
import ShoppingCart from 'lucide/dist/esm/icons/shopping-cart.mjs'
import Star from 'lucide/dist/esm/icons/star.mjs'
import StickyNote from 'lucide/dist/esm/icons/sticky-note.mjs'
import User from 'lucide/dist/esm/icons/user.mjs'
import Users from 'lucide/dist/esm/icons/users.mjs'
import Wallet from 'lucide/dist/esm/icons/wallet.mjs'
import Wifi from 'lucide/dist/esm/icons/wifi.mjs'
import { accentColour } from '../accents'

export const KIND_ICONS: Record<ItemKind, IconNode> = {
  login: User,
  alias: AtSign,
  card: CreditCard,
  note: StickyNote,
  identity: IdCard,
  custom: Shapes,
  ssh: KeySquare,
  wifi: Wifi,
}

export const VAULT_ICON_MARKS: Record<VaultIcon, IconNode> = {
  home: House,
  work: Briefcase,
  money: Wallet,
  heart: Heart,
  star: Star,
  shield: Shield,
  key: Key,
  cart: ShoppingCart,
  game: Gamepad,
  travel: Plane,
  school: GraduationCap,
  code: Code,
  family: Users,
  pet: PawPrint,
  music: Music,
  book: Book,
  gift: Gift,
  health: HeartPulse,
  car: Car,
  cloud: Cloud,
}

const ACCENT_OF: Record<Exclude<VaultColor, 'lime'>, string> = {
  purple: 'violet',
  pink: 'pink',
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  teal: 'teal',
  blue: 'blue',
  grey: 'slate',
}

export function vaultColour(color: VaultColor, scheme: 'dark' | 'light'): string {
  if (color !== 'lime') return accentColour(ACCENT_OF[color], scheme)
  const green = accentColour('green', scheme)
  const yellow = accentColour('yellow', scheme)
  return `color-mix(in srgb, ${green} 55%, ${yellow})`
}
