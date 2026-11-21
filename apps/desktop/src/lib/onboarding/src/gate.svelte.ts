import { isRecord, keepJson, stored } from '../../platform/src/api'

export const PROGRESS_KEY = 'orden:setup'
class Gate {
  showing = $state(false)
  guiding = $state(false)
  restore() {
    const kept = stored(PROGRESS_KEY)
    if (isRecord(kept)) this.showing = true
    else if (kept === 'waiting') void import('./wait')
  }
  finish() {
    this.showing = false
    keepJson(PROGRESS_KEY, 'done')
  }
}
export const gate = new Gate()
