import { stillness } from '../../platform/src/api'
import { type Feel, PIXELS, resting, SHARE, spring, type Spring as Sprung, step } from '../../springs/src/api'

const OPENING: Feel = { response: 0.43, damping: 0.72 }
const CLOSING: Feel = { response: 0.34, damping: 1 }
export const FOLLOWING: Feel = { response: 0.21, damping: 0.87 }
export const TRAILING: Feel = { response: 0.39, damping: 1 }

export class Spring {
  value = $state(0)
  private readonly one: Sprung
  from = 0
  constructor(
    private readonly rising: Feel,
    private readonly falling: Feel = rising,
    rest = SHARE,
  ) {
    this.one = spring(0, rest)
  }
  get target(): number {
    return this.one.to
  }
  aim(target: number, after = 0) {
    this.one.to = target
    this.from = performance.now() + after
  }
  jump(value: number) {
    this.one.at = value
    this.one.to = value
    this.one.speed = 0
    this.value = value
  }
  step(seconds: number, now: number): boolean {
    if (now < this.from) return true
    if (this.one.at === this.one.to && this.one.speed === 0) return false
    step(this.one, seconds, this.one.to > this.one.at ? this.rising : this.falling)
    this.value = this.one.at
    return !resting(this.one) || this.one.at !== this.one.to
  }
}

export class Springs {
  private readonly all: Spring[] = []
  private frame = 0
  private last = 0
  add(one: Spring): Spring {
    this.all.push(one)
    return one
  }
  wake() {
    if (stillness()) this.settle()
    else this.loop()
  }
  private settle() {
    let waiting = false
    for (const one of this.all) {
      if (performance.now() >= one.from) one.jump(one.target)
      else waiting = true
    }
    if (waiting) this.loop()
  }
  private loop() {
    if (this.frame) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }
  private readonly tick = (now: number) => {
    const seconds = Math.max(0, (now - this.last) / 1000)
    this.last = now
    let moving = false
    for (const one of this.all) {
      if (stillness() && now >= one.from) one.jump(one.target)
      else if (one.step(seconds, now)) moving = true
    }
    this.frame = moving ? requestAnimationFrame(this.tick) : 0
  }
  stop() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }
}

const keyOf = (slot: number, kind: string) => `${slot}:${kind}`
export class Motion extends Springs {
  private readonly lifts: Record<number, Spring> = {}
  private readonly grows: Record<string, Spring> = {}
  private readonly pulls: Record<string, Spring> = {}
  constructor(slots: readonly (readonly string[] | null)[]) {
    super()
    slots.forEach((kinds, slot) => {
      if (!kinds) return
      this.lifts[slot] = this.add(new Spring(OPENING, CLOSING))
      for (const kind of kinds) {
        this.grows[keyOf(slot, kind)] = this.add(new Spring(OPENING, CLOSING))
        this.pulls[keyOf(slot, kind)] = this.add(new Spring(FOLLOWING, FOLLOWING, PIXELS))
      }
    })
  }
  private static readonly RESTING = new Spring(OPENING)
  lift(slot: number): Spring {
    return this.lifts[slot] ?? Motion.RESTING
  }
  grow(slot: number, kind: string): Spring {
    return this.grows[keyOf(slot, kind)] ?? Motion.RESTING
  }
  pull(slot: number, kind: string): Spring {
    return this.pulls[keyOf(slot, kind)] ?? Motion.RESTING
  }
  get pulled(): number {
    let most = 0
    for (const one of Object.values(this.pulls)) most = Math.max(most, one.value)
    return most
  }
}
