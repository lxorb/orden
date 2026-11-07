import { keep, storedText } from '../stored'

const KEY = 'nib:icon-tabs'

class IconTabs {
  on = $state(storedText(KEY) === 'yes')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'yes' : 'no')
  }
}

export const iconTabs = new IconTabs()

const FIT_KEY = 'nib:fit-tabs'

class FitTabs {
  on = $state(storedText(FIT_KEY) !== 'no')

  set(on: boolean) {
    this.on = on
    keep(FIT_KEY, on ? 'yes' : 'no')
  }
}

export const fitTabs = new FitTabs()
