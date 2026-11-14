import { compactsAt, estimate, estimateText, filled } from '../chat/usage'
import type { AutoCompact, Turn, Usage } from '../../ai-providers/src/api'

export interface Bands {
  used: number
  window: number | null
  instructions: number
  attached: number
  conversation: number
  next: number
  compacts: number | null
  fraction: number | null
  warn: boolean
}

export function attachedIn(turns: readonly Turn[], since?: string): number {
  const from = since ? turns.findIndex((one) => one.id === since) + 1 : 0
  let sum = 0
  for (const turn of turns.slice(from)) {
    if (turn.role === 'you' && turn.draft)
      sum += estimate({ text: '', attachments: turn.draft.attachments })
  }
  return sum
}

export function bandsOf(
  usage: Usage,
  window: number | null,
  instructions: string,
  attached: number,
  next: number,
  auto: AutoCompact = 'auto',
): Bands {
  const used = filled(usage)
  const told = used ? estimateText(instructions) : 0
  const sent = Math.min(attached, Math.max(0, used - told))
  const fraction = window ? Math.min(1, (used + next) / window) : null
  return {
    used,
    window,
    instructions: Math.min(told, used),
    attached: used ? sent : 0,
    conversation: Math.max(0, used - told - sent),
    next,
    compacts: compactsAt(window, auto),
    fraction,
    warn: (fraction ?? 0) >= 0.8,
  }
}
