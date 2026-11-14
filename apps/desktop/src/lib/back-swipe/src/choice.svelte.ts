import { keep, storedText } from '../../platform/src/api'

const KEY = 'orden:swipe'

class SwipeChoice {
  on = $state(storedText(KEY) !== 'off')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'on' : 'off')
  }
}

export const swipeChoice = new SwipeChoice()
