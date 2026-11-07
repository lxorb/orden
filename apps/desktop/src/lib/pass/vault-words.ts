import type { VaultColor, VaultIcon } from '@orden/pass/types'
import { t } from '../i18n.svelte'

const COLORS: Record<VaultColor, () => string> = {
  purple: () => t('Purple'),
  pink: () => t('Pink'),
  red: () => t('Red'),
  orange: () => t('Orange'),
  yellow: () => t('Yellow'),
  lime: () => t('Lime'),
  green: () => t('Green'),
  teal: () => t('Teal'),
  blue: () => t('Blue'),
  grey: () => t('Grey'),
}

const ICONS: Record<VaultIcon, () => string> = {
  home: () => t('Home'),
  work: () => t('Work'),
  money: () => t('Money'),
  heart: () => t('Heart'),
  star: () => t('Star'),
  shield: () => t('Shield'),
  key: () => t('Key'),
  cart: () => t('Shopping'),
  game: () => t('Games'),
  travel: () => t('Travel'),
  school: () => t('School'),
  code: () => t('Code'),
  family: () => t('Family'),
  pet: () => t('Pets'),
  music: () => t('Music'),
  book: () => t('Books'),
  gift: () => t('Gifts'),
  health: () => t('Health'),
  car: () => t('Car'),
  cloud: () => t('Cloud'),
}

export function colorName(color: VaultColor): string {
  return COLORS[color]()
}

export function iconName(icon: VaultIcon): string {
  return ICONS[icon]()
}
