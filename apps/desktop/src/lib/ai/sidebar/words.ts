import type { Effort } from '../chat/types'

const EFFORTS: Record<Effort, string> = {
  auto: 'Auto',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
}

export function effortWord(effort: Effort): string {
  return EFFORTS[effort]
}
