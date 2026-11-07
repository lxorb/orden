import { keepJson, stored } from '../stored'
import { CRASHES_TOLD as TOLD } from '../surfaces.svelte'

const SENDING = 'nib:crash-reports'

class CrashReports {
  on = $state(stored(SENDING) !== false)

  telling = $state(false)

  set(on: boolean): void {
    this.on = on
    keepJson(SENDING, on)
  }

  tell(): void {
    if (stored(TOLD) === true) return
    this.telling = true
  }

  told(): void {
    this.telling = false
    keepJson(TOLD, true)
  }
}

export const crashReports = new CrashReports()
