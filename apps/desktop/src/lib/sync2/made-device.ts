import { forget, keep, storedText } from '../stored'
import { DEVICE } from './hub-frames'

const MADE_ID = 'orden:hub-device'

const keyOf = (account: string | null) => (account ? `${MADE_ID}:${account}` : MADE_ID)

export function madeDeviceId(account: string | null): string {
  const key = keyOf(account)
  const held = storedText(key)
  if (held && DEVICE.test(held)) return held

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const made = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  keep(key, made)
  return made
}

export function forgetMadeDeviceId(account: string): void {
  forget(keyOf(account))
}
