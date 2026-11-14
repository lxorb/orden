export interface EchoScreen {
  readonly cols: number
  cursor(): { x: number; y: number }
  char(x: number, y: number): string
}

export interface Guess {
  x: number
  y: number
  char: string
  at: number
  blind: boolean
}

export const SHOW_FROM = 30
export const HIDE_UNDER = 20
const SAMPLES = 24
const DECIDES = 5
const ACCURATE = 0.3
const PATIENCE = 500

export class Predictor {
  private guesses: Guess[] = []
  private trusted = false
  private sealed = false
  private readonly latencies: number[] = []
  private readonly outcomes: boolean[] = []
  private worth = false

  constructor(private readonly now: () => number) {}

  typed(data: string, screen: EchoScreen, may: boolean): void {
    if (!may) {
      this.drop()
      return
    }
    for (const char of data) {
      if (this.sealed) continue
      const last = this.guesses.at(-1)
      const { x, y } = last ? { x: last.x + 1, y: last.y } : screen.cursor()
      if (!printable(char) || x >= screen.cols - 1) {
        this.seal()
        continue
      }
      const under = screen.char(x, y)
      const blind = under !== '' && under !== ' ' && under !== char
      this.guesses.push({ x, y, char, at: this.now(), blind })
    }
  }

  check(screen: EchoScreen, may: boolean): boolean {
    if (!may) return this.drop()
    const before = this.guesses.length
    const cursor = screen.cursor()
    while (this.guesses.length) {
      const guess = this.guesses[0]
      if (!guess) break
      if (cursor.y < guess.y) return this.wrong()
      const passed = cursor.y > guess.y || cursor.x > guess.x
      if (!passed) break
      if (!guess.blind && screen.char(guess.x, guess.y) !== guess.char) return this.wrong()
      this.guesses.shift()
      if (guess.blind) this.trusted = false
      else this.right(this.now() - guess.at)
    }
    if (!this.guesses.length && this.sealed) {
      this.sealed = false
      this.trusted = false
    }
    const oldest = this.guesses[0]
    if (oldest && this.now() - oldest.at > this.patience()) return this.wrong()
    return this.guesses.length !== before
  }

  get shown(): readonly Guess[] {
    if (!this.trusted || !this.worth) return []
    const blind = this.guesses.findIndex((guess) => guess.blind)
    return blind < 0 ? this.guesses : this.guesses.slice(0, blind)
  }

  get deadline(): number | null {
    const oldest = this.guesses[0]
    return oldest ? oldest.at + this.patience() : null
  }

  get latency(): number | null {
    if (!this.latencies.length) return null
    const sorted = [...this.latencies].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? null
  }

  reset(): void {
    this.drop()
  }

  private seal(): void {
    if (this.guesses.length) this.sealed = true
    else this.trusted = false
  }

  private patience(): number {
    return Math.max(PATIENCE, this.latencies.reduce((high, one) => Math.max(high, one), 0) * 1.5)
  }

  private right(latency: number): void {
    this.trusted = true
    keep(this.latencies, latency)
    keep(this.outcomes, true)
    this.decide()
  }

  private wrong(): boolean {
    keep(this.outcomes, false)
    this.decide()
    this.drop()
    return true
  }

  private drop(): boolean {
    const shown = this.shown.length > 0
    this.guesses = []
    this.trusted = false
    this.sealed = false
    return shown
  }

  private decide(): void {
    const median = this.latency
    const right = this.outcomes.filter(Boolean).length
    if (
      this.outcomes.length < DECIDES ||
      median === null ||
      right / this.outcomes.length < ACCURATE
    ) {
      this.worth = false
    } else if (median >= SHOW_FROM) {
      this.worth = true
    } else if (median < HIDE_UNDER) {
      this.worth = false
    }
  }
}

function printable(char: string): boolean {
  const code = char.charCodeAt(0)
  return char.length === 1 && code >= 0x20 && code <= 0x7e
}

function keep<T>(list: T[], value: T): void {
  list.push(value)
  if (list.length > SAMPLES) list.shift()
}
