import type { Context, Row } from '@orden/bases'
import { linkContext } from '@orden/bases/links'
import { account } from '../../accounts/src/api'

export interface ContextStart {
  rows: readonly Row[]
  today: string
  now: string
  this?: Row | undefined
  search?: string
  me?: string | undefined
}

export function contextFor(start: ContextStart): Context {
  const context: Context = { today: start.today, now: start.now, ...linkContext(start.rows) }
  if (start.this) context.this = start.this
  if (start.search) context.search = start.search
  const me = start.me ?? account.name
  if (me) context.me = me
  return context
}
