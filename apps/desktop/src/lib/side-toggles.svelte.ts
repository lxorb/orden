import { keep, storedText } from './stored'

const KEY = 'orden:side-toggles-inside'

class SideToggles {
  inside = $state(storedText(KEY) === 'yes')

  set(inside: boolean) {
    this.inside = inside
    keep(KEY, inside ? 'yes' : 'no')
  }
}

export const sideToggles = new SideToggles()
