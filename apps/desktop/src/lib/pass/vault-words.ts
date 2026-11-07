import type { VaultColor } from '@orden/pass/types'
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

export function colorName(color: VaultColor): string {
  return COLORS[color]()
}
