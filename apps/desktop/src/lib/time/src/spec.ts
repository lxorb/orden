import { isRecord } from '../../platform/src/api'

export type Kind = 'day' | 'week' | 'month' | 'custom'
const KINDS: readonly Kind[] = ['day', 'week', 'month', 'custom']
export interface Spec {
  range: Kind
  from: number | null
  to: number | null
  untracked: boolean
}
const numberOr = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
export function readSpec(text: string): Spec {
  let value: unknown = null
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (!isRecord(value)) return { range: 'day', from: null, to: null, untracked: true }
  const old = value.view === 'reports' || value.view === 'week' ? 'week' : null
  const range = KINDS.find((one) => one === value.range) ?? old ?? 'day'
  const from = range === 'custom' ? numberOr(value.from) : null
  const to = range === 'custom' ? numberOr(value.to) : null
  return {
    range: range === 'custom' && (from === null || to === null) ? 'day' : range,
    from,
    to,
    untracked: value.untracked !== false,
  }
}
export const writeSpec = (spec: Spec): string => JSON.stringify(spec)
