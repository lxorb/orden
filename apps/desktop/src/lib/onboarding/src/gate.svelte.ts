import { isNative, isRecord, keepJson, stored, storedText } from '../../platform/src/api'

export const PROGRESS_KEY = 'orden:setup'
export function aheadOf(native: boolean, read: (key: string) => string | null): 'setup' | null {
  const kept = read(PROGRESS_KEY)
  if (kept?.startsWith('{')) return 'setup'
  const fresh = kept === null && read('orden:seeded') === null && read('orden:workspace') === null
  return native && fresh ? 'setup' : null
}
class Gate {
  showing = $state(false)
  guiding = $state(false)
  ahead = $state(aheadOf(isNative, storedText))
  restore() {
    const kept = stored(PROGRESS_KEY)
    if (isRecord(kept)) this.showing = true
    else if (kept === 'waiting') void import('./wait')
  }
  letGo() {
    this.ahead = null
  }
  finish() {
    this.showing = false
    keepJson(PROGRESS_KEY, 'done')
  }
}
export const gate = new Gate()
