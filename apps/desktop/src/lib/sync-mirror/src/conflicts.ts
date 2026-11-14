const CONFLICT_RULES = ['both', 'newest', 'ask'] as const

export type ConflictRule = (typeof CONFLICT_RULES)[number]

export const DEFAULT_RULE: ConflictRule = 'both'

export function conflictRule(value: unknown): ConflictRule | null {
  return typeof value === 'string' && (CONFLICT_RULES as readonly string[]).includes(value)
    ? (value as ConflictRule)
    : null
}

export interface Clash {
  path: string
  id: string
  version: number
  theirs: string
  at: number
}

export type Answer = 'mine' | 'theirs' | 'both'
