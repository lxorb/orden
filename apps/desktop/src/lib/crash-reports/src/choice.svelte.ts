import { keepJson, stored } from '../../platform/src/api'
import { CRASH_REPORTS, crashAskDue, CRASHES_ASKED } from '../../surfaces/src/api'

class CrashReports {
  on = $state(stored(CRASH_REPORTS) !== false)

  asking = $state(false)

  set(on: boolean): void {
    this.on = on
    keepJson(CRASH_REPORTS, on)
  }

  ask(): void {
    if (crashAskDue()) this.asking = true
  }

  answer(on: boolean): void {
    if (!this.asking) return
    this.asking = false
    this.set(on)
    keepJson(CRASHES_ASKED, true)
  }
}

export const crashReports = new CrashReports()
