import { keep, storedText } from '../platform/src/api'

const KEY = 'orden:icon-tabs'

class IconTabs {
  on = $state(storedText(KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const iconTabs = new IconTabs()

const FIT_KEY = 'orden:fit-tabs'

class FitTabs {
  on = $state(storedText(FIT_KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(FIT_KEY, on ? 'yes' : 'no')
  }
}

export const fitTabs = new FitTabs()
