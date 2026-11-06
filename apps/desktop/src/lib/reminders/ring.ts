import type { Reminder } from './plan'

const HORIZON = 21 * 86_400_000

export interface Bell {
  now(): number
  show(one: Reminder): void
  later(run: () => void, ms: number): () => void
}

export class Ringer {
  private readonly waiting = new Map<string, () => void>()
  private readonly rung = new Set<string>()

  constructor(private readonly bell: Bell) {}

  ring(plan: readonly Reminder[]) {
    for (const stop of this.waiting.values()) stop()
    this.waiting.clear()

    const now = this.bell.now()
    for (const one of plan) {
      const wait = one.at - now
      if (this.rung.has(one.id) || wait > HORIZON) continue
      this.waiting.set(
        one.id,
        this.bell.later(
          () => {
            this.waiting.delete(one.id)
            this.rung.add(one.id)
            this.bell.show(one)
          },
          Math.max(wait, 0),
        ),
      )
    }
  }
}
