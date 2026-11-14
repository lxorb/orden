import type { GoalState } from '../chat/types'

export interface Limit {
  state: 'fine' | 'near' | 'reached'
  until: number | null
  untilWords: string | null
}

export interface ToolHeard {
  id: string
  name: string
  args?: unknown
  done?: { text: string; error: boolean }
}

export interface Counted {
  input?: number
  cached?: number
  output?: number
  reasoning?: number
  window?: number
}

type TurnEnd = 'end' | 'stopped' | 'error'

export interface Heard {
  text?: string
  thinking?: string
  tool?: ToolHeard
  usage?: Counted
  ended?: TurnEnd
  compacted?: boolean
  model?: string
  limit?: Limit
  trouble?: string
  signedOut?: boolean
  goal?: GoalState
}

export function eventIn(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function saysSignedOut(words: string): boolean {
  return /not logged in|please run \/login|not signed in|invalid api key|401|unauthori[sz]ed|oauth token (?:has )?expired/i.test(
    words,
  )
}

export function saysLimit(words: string): boolean {
  return /usage limit|hit your (?:usage )?limit|limit reached|rate limit/i.test(words)
}
