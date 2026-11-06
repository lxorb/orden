import { keep, storedText } from '../stored'

const KEY = 'nib:swipe'

class SwipeChoice {
  on = $state(storedText(KEY) !== 'off')

  set(on: boolean) {
    this.on = on
    keep(KEY, on ? 'on' : 'off')
  }
}

export const swipeChoice = new SwipeChoice()
