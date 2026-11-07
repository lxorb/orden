import { isCount, isSealed, MOST_ITEM_BYTES, MOST_KEY_BYTES } from '@orden/pass/wire'
import type { Body } from '../body'

export interface Sealed {
  rev: number
  key: string
  body: string
  keyVersion: number
}

export function sealedIn(body: Body): Sealed | null {
  const rev = body.count('rev')
  const key = body.text('key', MOST_KEY_BYTES)
  const sealed = body.text('body', MOST_ITEM_BYTES)
  const keyVersion = body.count('keyVersion')
  if (
    !isCount(rev) ||
    !isSealed(key, MOST_KEY_BYTES) ||
    !isSealed(sealed, MOST_ITEM_BYTES) ||
    !isCount(keyVersion)
  )
    return null
  return { rev, key, body: sealed, keyVersion }
}
