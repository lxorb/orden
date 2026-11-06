export class Random {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(below: number): number {
    return Math.floor(this.next() * below)
  }

  between(low: number, high: number): number {
    return low + this.int(high - low + 1)
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(list: readonly T[]): T | undefined {
    return list.length ? list[this.int(list.length)] : undefined
  }

  shuffled<T>(list: readonly T[]): T[] {
    const out = [...list]
    for (let at = out.length - 1; at > 0; at--) {
      const other = this.int(at + 1)
      const here = out[at]
      const there = out[other]
      if (here === undefined || there === undefined) continue
      out[at] = there
      out[other] = here
    }
    return out
  }

  weighted<T>(options: readonly (readonly [T, number])[]): T {
    const total = options.reduce((sum, [, weight]) => sum + weight, 0)
    let at = this.next() * total
    for (const [option, weight] of options) {
      at -= weight
      if (at < 0) return option
    }
    const last = options.at(-1)
    if (!last) throw new Error('weighted: no options')
    return last[0]
  }
}
