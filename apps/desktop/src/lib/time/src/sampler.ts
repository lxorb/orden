import { MinuteFold, type Minute, SAMPLE_EVERY } from './minutes'
import type { Sensed } from './sensed'

export const ANSWER_WITHIN = SAMPLE_EVERY - 1000
function answered<T>(asked: Promise<T>, within: number, otherwise: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(otherwise), within)
    void asked.then(resolve, () => resolve(otherwise)).finally(() => clearTimeout(timer))
  })
}
export interface Senses {
  asked(): Promise<Sensed | null>
  near(): Sensed
  seen(sensed: Sensed, at: number): void
  leading(): boolean
  kept(minutes: Minute[]): void
}
export class Sampler {
  private looking = false
  private readonly fold = new MinuteFold()
  constructor(private readonly senses: Senses) {}
  async look(): Promise<void> {
    if (this.looking) return
    this.looking = true
    try {
      const sensed = (await answered(this.senses.asked(), ANSWER_WITHIN, null)) ?? this.senses.near()
      const at = Date.now()
      this.senses.seen(sensed, at)
      if (!this.senses.leading()) return
      const closed = this.fold.add({ at, ...sensed })
      if (closed.length) this.senses.kept(closed)
    } finally {
      this.looking = false
    }
  }
  flush(keep = true): void {
    const last = this.fold.flush()
    if (last && keep) this.senses.kept([last])
  }
}
