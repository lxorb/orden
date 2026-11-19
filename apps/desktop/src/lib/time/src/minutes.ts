export const SAMPLE_EVERY = 5000
export const KEEP_MINUTES = 90 * 24 * 60 * 60_000
export interface Sample {
  at: number
  idleMs: number | null
  lid: boolean | null
  locked: boolean | null
}
export interface Minute {
  at: number
  active: number
  samples: number
  lid: boolean | null
  locked: boolean | null
}
const minuteOf = (at: number): number => Math.floor(at / 60_000) * 60_000
const fresh = (at: number): Minute => ({
  at,
  active: 0,
  samples: 0,
  lid: null,
  locked: null,
})
const MINUTE = 60_000
const LONGEST_GAP = 75_000
function folded(minute: Minute, sample: Sample): Minute {
  return {
    at: minute.at,
    active: minute.active,
    samples: minute.samples + 1,
    lid: sample.lid === false || minute.lid === false ? false : (sample.lid ?? minute.lid),
    locked: sample.locked === true || minute.locked === true ? true : (sample.locked ?? minute.locked),
  }
}
export class MinuteFold {
  private current: Minute | null = null
  private last: number | null = null
  add(sample: Sample): Minute[] {
    const closed: Minute[] = []
    const into = (at: number): Minute => {
      if (this.current?.at === at) return this.current
      if (this.current) closed.push(this.current)
      this.current = fresh(at)
      return this.current
    }
    const since = this.last === null ? Infinity : sample.at - this.last
    this.last = sample.at
    const gap = since > 0 && since <= LONGEST_GAP ? since : null
    const busy = sample.idleMs !== null && sample.idleMs < (gap ?? SAMPLE_EVERY) && sample.locked !== true
    if (busy && gap === null) {
      const minute = into(minuteOf(sample.at))
      minute.active = Math.min(60, minute.active + SAMPLE_EVERY / 1000)
    }
    for (let start = minuteOf(sample.at - (gap ?? 0)); busy && gap !== null && start < sample.at; start += MINUTE) {
      if (this.current && start < this.current.at) continue
      const minute = into(start)
      const seconds = (Math.min(start + MINUTE, sample.at) - Math.max(start, sample.at - gap)) / 1000
      minute.active = Math.min(60, minute.active + seconds)
    }
    const here = minuteOf(sample.at)
    if (!this.current || this.current.at <= here) this.current = folded(into(here), sample)
    return closed
  }
  flush(): Minute | null {
    const was = this.current
    this.current = null
    this.last = null
    return was
  }
}
export function minuteValue(value: unknown): Minute | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const number = (key: string) => (typeof one[key] === 'number' && Number.isFinite(one[key]) ? one[key] : null)
  const flag = (key: string) => (typeof one[key] === 'boolean' ? one[key] : null)
  const at = number('at')
  if (at === null) return null
  return {
    at,
    active: Math.min(60, Math.max(0, number('active') ?? 0)),
    samples: number('samples') ?? 0,
    lid: flag('lid'),
    locked: flag('locked'),
  }
}
