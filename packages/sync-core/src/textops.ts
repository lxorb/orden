import type * as Y from 'yjs'
import { edits } from './diff'

export function textops(text: Y.Text, from: string, to: string, origin?: unknown): number {
  if (text.length !== from.length) {
    throw new Error(`textops: the shared text is ${text.length} long, not ${from.length}`)
  }

  const changes = edits(from, to, 'operations')
  if (!changes.length) return 0

  let count = 0
  const apply = () => {
    for (let at = changes.length - 1; at >= 0; at--) {
      const change = changes[at]
      if (!change) continue

      if (change.to > change.from) {
        text.delete(change.from, change.to - change.from)
        count++
      }
      if (change.insert) {
        text.insert(change.from, change.insert)
        count++
      }
    }
  }

  if (text.doc) text.doc.transact(apply, origin)
  else apply()

  return count
}
