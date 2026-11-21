import { whileShown } from '../../panes/src/api'
import { todayHere } from './days'

const LOOK_EVERY = 60_000
class Day {
  #today = $state(todayHere())
  #heard = false
  get today(): string {
    this.#hear()
    return this.#today
  }
  again(): void {
    const now = todayHere()
    if (now !== this.#today) this.#today = now
  }
  #hear() {
    if (this.#heard || typeof window === 'undefined') return
    this.#heard = true
    window.addEventListener('focus', () => this.again())
    document.addEventListener('visibilitychange', () => this.again())
  }
}
export const day = new Day()
export function dayWhileShown(): void {
  whileShown(LOOK_EVERY, () => day.again())
}
