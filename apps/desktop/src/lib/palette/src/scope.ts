import { keep, storedText } from '../../platform/src/api'
import type { Row } from './rows'

export type Scope = 'all' | 'here'
export const SCOPE_KEY = 'orden:palette-scope'
export const keptScope = (): Scope => (storedText(SCOPE_KEY) === 'here' ? 'here' : 'all')
export const keepScope = (scope: Scope): boolean => keep(SCOPE_KEY, scope)
const checked = (row: Row) => row.kind === 'command' && row.command.checked === true
export function distinct(rows: readonly Row[], shown: (row: Row) => string): Row[] {
  const at = new Map<string, number>()
  const out: Row[] = []
  for (const row of rows) {
    const key = shown(row)
    const kept = at.get(key)
    if (kept === undefined) {
      at.set(key, out.length)
      out.push(row)
    } else {
      const first = out.at(kept)
      if (checked(row) && !(first && checked(first))) out[kept] = row
    }
  }
  return out
}
