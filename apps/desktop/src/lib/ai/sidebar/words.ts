import { key } from '../../i18n.svelte'
import type { Effort } from '../chat/types'

const EFFORTS: Record<Effort, string> = {
  auto: key('Auto'),
  off: key('Off'),
  minimal: key('Minimal'),
  low: key('Low'),
  medium: key('Medium'),
  high: key('High'),
  xhigh: key('Extra'),
  max: key('Max'),
}

export function effortWord(effort: Effort): string {
  return EFFORTS[effort]
}
