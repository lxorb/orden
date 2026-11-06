import type { Random } from './random'

export class Clock {
  now = 0

  advance(by: number) {
    this.now += by
  }
}

export interface Faults {
  drop: number
  duplicate: number
  lostReply: number
  delay: readonly [number, number]
}

export const CALM: Faults = { drop: 0, duplicate: 0, lostReply: 0, delay: [1, 3] }

export const PATIENCE = 60

interface Event {
  at: number
  order: number
  run: () => Promise<void>
}

export class Network {
  private events: Event[] = []
  private counter = 0
  private readonly cut = new Set<string>()
  faults: Faults

  constructor(
    private readonly random: Random,
    private readonly clock: Clock,
    faults: Faults,
  ) {
    this.faults = faults
  }

  isOffline(device: string): boolean {
    return this.cut.has(device)
  }

  setOffline(device: string, offline: boolean) {
    if (offline) this.cut.add(device)
    else this.cut.delete(device)
  }

  private delay(): number {
    const [low, high] = this.faults.delay
    return this.random.between(low, high)
  }

  private schedule(after: number, run: () => Promise<void>) {
    this.counter += 1
    this.events.push({ at: this.clock.now + after, order: this.counter, run })
  }

  request(device: string, deliver: () => Promise<Uint8Array>): Promise<Uint8Array | null> {
    if (this.cut.has(device)) return Promise.resolve(null)

    return new Promise((resolve) => {
      let settled = false
      const answer = (value: Uint8Array | null) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      const arrive = async () => {
        if (this.cut.has(device) || this.random.chance(this.faults.drop)) return
        const reply = await deliver()
        if (this.random.chance(this.faults.lostReply)) return

        const back = async () => {
          if (!this.cut.has(device)) answer(reply)
        }
        this.schedule(this.delay(), back)
        if (this.random.chance(this.faults.duplicate)) this.schedule(this.delay(), back)
      }

      this.schedule(this.delay(), arrive)
      if (this.random.chance(this.faults.duplicate)) this.schedule(this.delay(), arrive)
      this.schedule(PATIENCE, async () => {
        answer(null)
      })
    })
  }

  async deliver(): Promise<number> {
    let ran = 0
    for (;;) {
      const due = this.events.filter((event) => event.at <= this.clock.now)
      if (!due.length) return ran
      this.events = this.events.filter((event) => event.at > this.clock.now)
      for (const event of this.random.shuffled(due)) {
        await event.run()
        ran += 1
      }
    }
  }

  quiet(): boolean {
    return this.events.length === 0
  }
}
