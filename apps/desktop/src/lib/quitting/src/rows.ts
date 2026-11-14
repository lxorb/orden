import { portOf, type Stopping, STOPPING_KINDS } from '@orden/contracts'
import type { Warning } from './state.svelte'

export type Why = 'quit' | 'window' | 'restart'

export function asks(warning: Warning, rows: readonly Stopping[]): boolean {
  if (warning === 'never') return false
  return warning === 'always' ? rows.length > 0 : rows.some((row) => row.busy)
}

export async function rowsHere(window: string, idle: boolean): Promise<Stopping[]> {
  const found = await Promise.all(
    STOPPING_KINDS.map((kind) => {
      const port = portOf(`quit.${kind}`)
      return port.ok ? port.value.rows(window, idle) : Promise.resolve([])
    }),
  )
  return found.flat()
}

export async function showRow(row: Stopping): Promise<void> {
  const port = portOf(`quit.${row.kind}`)
  if (port.ok) await port.value.show(row)
}
