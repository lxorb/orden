import type { VaultColor } from '@orden/pass/types'

const COLORS: Record<VaultColor, () => string> = {
  purple: () => 'Purple',
  pink: () => 'Pink',
  red: () => 'Red',
  orange: () => 'Orange',
  yellow: () => 'Yellow',
  lime: () => 'Lime',
  green: () => 'Green',
  teal: () => 'Teal',
  blue: () => 'Blue',
  grey: () => 'Grey',
}

export function colorName(color: VaultColor): string {
  return COLORS[color]()
}
