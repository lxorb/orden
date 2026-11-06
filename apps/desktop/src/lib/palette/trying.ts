import type { SchemeChoice } from '../theme.svelte'
import type { Row } from './rows'

export interface Look {
  id: string
  scheme: SchemeChoice
  accent: string
}

const SCHEMES: readonly string[] = ['light', 'dark', 'system']

const isScheme = (value: string): value is SchemeChoice => SCHEMES.includes(value)

export function lookOf(row: Row | undefined, kept: Look): Look | null {
  if (row?.kind !== 'command' || row.command.disabled) return null

  const id = row.command.id
  const at = id.indexOf(':')
  const [part, value] = [id.slice(0, at), id.slice(at + 1)]
  if (at < 0) return null
  if (part === 'theme') return { ...kept, id: value }
  if (part === 'accent') return { ...kept, accent: value }
  if (part === 'scheme' && isScheme(value)) return { ...kept, scheme: value }

  return null
}
