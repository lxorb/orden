import type { Strength } from '@orden/pass/strength'

export function strengthWord(strength: Strength): string {
  switch (strength) {
    case 'vulnerable':
      return 'Vulnerable'
    case 'weak':
      return 'Weak'
    case 'strong':
      return 'Strong'
  }
}
