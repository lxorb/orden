import { keep, storedText } from '../../platform/src/api'

const SEEN = 'orden:pen-seen'
const DRAWS = 'orden:finger-draws'
const saved = (key: string): boolean => storedText(key) === 'yes'
function remember(key: string, on: boolean) {
  keep(key, on ? 'yes' : 'no')
}
class Hand {
  penSeen = $state(saved(SEEN))
  fingerDraws = $state(saved(DRAWS))
  sawPen() {
    if (this.penSeen) return
    this.penSeen = true
    remember(SEEN, true)
  }
  toggleFinger() {
    this.fingerDraws = !this.fingerDraws
    remember(DRAWS, this.fingerDraws)
  }
}
export const hand = new Hand()
