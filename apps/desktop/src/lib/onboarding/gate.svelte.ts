import { isRecord, keepJson, stored } from '../stored'

export const PROGRESS_KEY = 'orden:setup'

class Gate {
  showing = $state(false)

  restore() {
    if (isRecord(stored(PROGRESS_KEY))) this.showing = true
  }

  finish() {
    this.showing = false
    keepJson(PROGRESS_KEY, 'done')
  }
}

export const gate = new Gate()
