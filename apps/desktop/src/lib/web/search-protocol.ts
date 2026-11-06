import type { FuzzyHit } from '@orden/scan/search/fuzzy'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import type { Warmth } from '../search/warmth'

export interface Ask {
  kind: 'ask'
  id: number
  root: string
  query: Query
  terms: string[]
  limit: number
  excluded: string[]
}

export interface Warm {
  kind: 'warm'
  root: string
}

export type Answer =
  | { kind: 'found'; id: number; hits: Hit[]; loose: FuzzyHit[] }
  | { kind: 'done'; id: number }
  | { kind: 'warmth'; warmth: Warmth }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isAsk(value: unknown): value is Ask {
  if (!isRecord(value) || value.kind !== 'ask') return false

  return (
    typeof value.id === 'number' &&
    typeof value.root === 'string' &&
    typeof value.limit === 'number' &&
    isRecord(value.query) &&
    Array.isArray(value.terms) &&
    value.terms.every((one) => typeof one === 'string') &&
    Array.isArray(value.excluded) &&
    value.excluded.every((one) => typeof one === 'string')
  )
}

export function isWarm(value: unknown): value is Warm {
  return isRecord(value) && value.kind === 'warm' && typeof value.root === 'string'
}

export function isAnswer(value: unknown): value is Answer {
  if (!isRecord(value)) return false
  if (value.kind === 'warmth') return isRecord(value.warmth)
  if (typeof value.id !== 'number') return false
  if (value.kind === 'done') return true

  return value.kind === 'found' && Array.isArray(value.hits) && Array.isArray(value.loose)
}
