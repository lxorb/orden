import { isBoolean, isNumber, isRecord, keepJson, recordOf, stored } from '../../stored'
import { isEffort } from './effort'
import type { Effort } from './types'

const STORAGE_KEY = 'orden:ai-chat'

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

function all(): Record<string, Learnt> {
  if (held) return held
  const read = recordOf(stored(STORAGE_KEY), learntIn)
  held = Object.fromEntries(Object.entries(read).map(([key, one]) => [key, cleaned(one)]))
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
  keepJson(STORAGE_KEY, held)
}

export function forgetLearnt(): void {
  held = null
}
