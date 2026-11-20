import { keepJson, stored } from '../../platform/src/api'

export const PERCENT = 'orden:time-percent'
class Percent {
  on = $state(stored(PERCENT) === true)
  set(value: boolean): void {
    this.on = value
    keepJson(PERCENT, value)
  }
}
export const percent = new Percent()
