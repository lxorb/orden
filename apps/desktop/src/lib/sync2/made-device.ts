/** The device id this device makes for itself where no store has one to give: a guest's,
 *  a build with no store, and an account before its store is made. Kept, so the hub sees
 *  one device; by account, so two accounts on one computer are never one device; and the
 *  account's is the one its store takes when it is made (`openSyncStore`), so the device
 *  has one id from its first word to the hub on. */

import { forget, keep, storedText } from '../stored'
import { DEVICE } from './hub-frames'

const MADE_ID = 'nib:hub-device'

const keyOf = (account: string | null) => (account ? `${MADE_ID}:${account}` : MADE_ID)

/** The id made for `account`, or for no account (a guest, the glasses), made now if
 *  there is none. */
export function madeDeviceId(account: string | null): string {
  const key = keyOf(account)
  const held = storedText(key)
  if (held && DEVICE.test(held)) return held

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const made = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  keep(key, made)
  return made
}

/** Signing out: the account's store goes, and the id made for it with it, so the next
 *  session is a new device as a new store is. */
export function forgetMadeDeviceId(account: string): void {
  forget(keyOf(account))
}
