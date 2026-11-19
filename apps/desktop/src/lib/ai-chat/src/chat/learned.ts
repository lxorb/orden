import { isBoolean, isNumber, isRecord, keepJson, recordOf, stored } from '../../../platform/src/api'
import { isEffort } from './effort'
import { lastMove, movedKeys, movesAfter, type Effort } from '../../../ai-providers/src/api'

const STORAGE_KEY = 'orden:ai-chat'

const MOVED = 'moved'

export interface Learnt {
  refused?: Effort[]
  window?: number
  reasons?: boolean
  perMessage?: boolean
  tools?: boolean
  picked?: Effort
}

function learntIn(value: unknown): value is Learnt {
  return isRecord(value)
}

function cleaned(value: Learnt): Learnt {
  const out: Learnt = {}
  if (Array.isArray(value.refused)) out.refused = value.refused.filter(isEffort)
  if (isNumber(value.window) && value.window > 0) out.window = value.window
  if (isBoolean(value.reasons)) out.reasons = value.reasons
  if (isBoolean(value.perMessage)) out.perMessage = value.perMessage
  if (isBoolean(value.tools)) out.tools = value.tools
  if (isEffort(value.picked)) out.picked = value.picked
  return out
}

let held: Record<string, Learnt> | null = null

let moved = 0

function read(): Record<string, Learnt> {
  const kept = stored(STORAGE_KEY)
  const cursor = isRecord(kept) ? kept[MOVED] : undefined
  moved = isNumber(cursor) ? cursor : 0
  const read = recordOf(kept, learntIn)
  return Object.fromEntries(Object.entries(read).map(([key, one]) => [key, cleaned(one)]))
}

function all(): Record<string, Learnt> {
  held ??= read()
  const moves = movesAfter(moved)
  if (moves.length) {
    held = movedKeys(held, moves)
    moved = lastMove(moves)
  }
  return held
}

function keyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

export function learnt(provider: string, model: string): Learnt {
  return all()[keyOf(provider, model)] ?? {}
}

export function learn(provider: string, model: string, change: Learnt): void {
  const key = keyOf(provider, model)
  const before = all()[key] ?? {}
  const refused = [...new Set([...(before.refused ?? []), ...(change.refused ?? [])])]
  const next = { ...before, ...change, ...(refused.length ? { refused } : {}) }
  held = { ...all(), [key]: next }
  keepJson(STORAGE_KEY, { ...held, [MOVED]: moved })
}

export function forgetLearnt(): void {
  held = null
}
