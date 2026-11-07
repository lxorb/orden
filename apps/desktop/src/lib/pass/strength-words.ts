import type { Strength } from '@orden/pass/strength'
import { t } from '../i18n.svelte'

export function strengthWord(strength: Strength): string {
  switch (strength) {
    case 'vulnerable':
      return t('Vulnerable')
    case 'weak':
      return t('Weak')
    case 'strong':
      return t('Strong')
  }
}
