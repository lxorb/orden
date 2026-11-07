import { keep, storedText } from './stored'

const KEY = 'orden:first-visit'

class FirstVisit {
  fresh = $state(false)

  seeded() {
    if (storedText(KEY) !== 'answered') this.fresh = true
  }

  answered() {
    this.fresh = false
    keep(KEY, 'answered')
  }
}

export const firstVisit = new FirstVisit()
