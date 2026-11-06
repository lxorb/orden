import { keep, storedText } from '../stored'

const KEY = 'nib:time-device'

export function timeDevice(): string {
  const held = storedText(KEY)
  if (held) return held
  const made = crypto.randomUUID()
  keep(KEY, made)
  return made
}
