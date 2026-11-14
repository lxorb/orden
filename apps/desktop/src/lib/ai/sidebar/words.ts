import type { Effort } from '../../ai-providers/src/api'

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
