import { todayHere } from './days'

const LOOK_EVERY = 60_000

class Day {
  #today = $state(todayHere())
  #looking: ReturnType<typeof setInterval> | null = null

  get today(): string {
    this.#look()
    return this.#today
  }

  again(): void {
    const now = todayHere()
    if (now !== this.#today) this.#today = now
  }

  #look() {
    if (this.#looking !== null) return
    this.#looking = setInterval(() => this.again(), LOOK_EVERY)
    if (typeof window === 'undefined') return
    window.addEventListener('focus', () => this.again())
    document.addEventListener('visibilitychange', () => this.again())
  }
}

export const day = new Day()
