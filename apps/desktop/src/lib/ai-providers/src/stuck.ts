import type { Account } from './accounts'
import { talkable } from './providers'

export function stuck({ kind, model }: Account): boolean {
  return !!model && !talkable(kind, [model]).length
}
