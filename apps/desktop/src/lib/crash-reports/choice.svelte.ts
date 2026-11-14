import { keepJson, stored } from '../platform/src/api'
import { CRASHES_ASKED, CRASH_REPORTS, crashAskDue } from '../surfaces.svelte'

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
