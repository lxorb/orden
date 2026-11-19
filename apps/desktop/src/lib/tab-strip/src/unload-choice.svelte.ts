import { keep, storedText } from '../../platform/src/api'

const KEY = 'orden:unload-tabs'
class UnloadTabs {
  on = $state(storedText(KEY) === 'yes')
  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}
export const unloadTabs = new UnloadTabs()
