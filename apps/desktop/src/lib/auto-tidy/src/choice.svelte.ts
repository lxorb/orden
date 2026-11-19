import { keep, storedText } from '../../platform/src/api'
import { seen } from './seen'

const ON = 'orden:auto-tidy'
const HOURS = 'orden:auto-tidy-hours'
export const TIDY_HOURS = 24
function hoursIn(text: string | null): number {
  const hours = Number(text)
  return text !== null && Number.isFinite(hours) && hours > 0 ? hours : TIDY_HOURS
}
class AutoTidy {
  on = $state(storedText(ON) === 'yes')
  hours = $state(hoursIn(storedText(HOURS)))
  set(on: boolean) {
    if (on === this.on) return
    if (on) seen.clear()
    this.on = on
    keep(ON, on ? 'yes' : 'no')
  }
  setHours(hours: number) {
    this.hours = hoursIn(String(hours))
    keep(HOURS, String(this.hours))
  }
}
export const autoTidy = new AutoTidy()
