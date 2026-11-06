import type { GoalTo } from '../chat/types'
import type { LocalKind } from '../providers'
import type { Say } from './session'

export const QUIET = 30_000

type Pursued = Extract<GoalTo, { do: 'set' | 'resume' }>

export function goalSaid(kind: LocalKind, to: Pursued): Say {
  if (kind === 'codex' && to.do === 'resume') return { kind: 'goal', goal: { do: 'resume' } }
  const budget = kind === 'codex' && to.do === 'set' ? to.tokens : undefined
  return {
    kind: 'goal',
    goal: { do: 'set', objective: to.condition, ...(budget ? { budget } : {}) },
  }
}

export function goalMessage(kind: LocalKind, to: Pursued): string {
  return kind === 'codex' && to.do === 'resume' ? to.text : to.condition
}

export function startsItsOwnTurn(kind: LocalKind): boolean {
  return kind === 'claude-code'
}

export function goalHeld(kind: LocalKind): Say {
  return { kind: 'goal', goal: { do: kind === 'codex' ? 'pause' : 'clear' } }
}

export const GOAL_CLEARED: Say = { kind: 'goal', goal: { do: 'clear' } }

export function goesOn(kind: LocalKind): boolean {
  return kind === 'codex'
}
