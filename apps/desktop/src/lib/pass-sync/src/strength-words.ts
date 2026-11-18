import type { Strength } from '@orden/pass/strength'

export function strengthWord(strength: Strength): string {
  return { vulnerable: 'Vulnerable', weak: 'Weak', strong: 'Strong' }[strength]
}
