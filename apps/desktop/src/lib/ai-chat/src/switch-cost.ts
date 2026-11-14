import type { AutoCompact, Usage } from '../../ai-providers/src/api'
import { compactsAt, filled } from './chat/usage'

export const ASK_FROM = 4_000

export interface SwitchCost {
  tokens: number
  compacts: boolean
}

export function switchCost(
  usage: Usage,
  from: { provider: string; model: string },
  to: { provider: string; model: string; window: number | null },
  auto: AutoCompact = 'auto',
): SwitchCost | null {
  if (from.provider === to.provider && from.model === to.model) return null
  const context = filled(usage)
  if (context < ASK_FROM) return null
  const at = compactsAt(to.window, auto)
  return { tokens: context, compacts: at !== null && context >= at }
}
