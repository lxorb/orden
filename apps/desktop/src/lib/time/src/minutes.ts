export const SAMPLE_EVERY = 5000

export const KEEP_MINUTES = 90 * 24 * 60 * 60_000

export interface Sample {
  at: number
  idleMs: number | null
  cpu: number | null
  memory: number | null
  battery: number | null
  charging: boolean | null
  lid: boolean | null
  locked: boolean | null
}

export interface Minute {
  at: number
  active: number
  samples: number
  cpu: number | null
  memory: number | null
  battery: number | null
  charging: boolean | null
  lid: boolean | null
  locked: boolean | null
}

const minuteOf = (at: number): number => Math.floor(at / 60_000) * 60_000

const share = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value))

function fresh(sample: Sample): Minute {
  return {
    at: minuteOf(sample.at),
    active: 0,
    samples: 0,
    cpu: null,
    memory: null,
    battery: null,
    charging: null,
    lid: null,
    locked: null,
  }
}

function folded(minute: Minute, sample: Sample): Minute {
  const busy = sample.idleMs !== null && sample.idleMs < SAMPLE_EVERY && sample.locked !== true
  const cpu = share(sample.cpu)
  const samples = minute.samples + 1
  return {
    at: minute.at,
    active: Math.min(60, minute.active + (busy ? SAMPLE_EVERY / 1000 : 0)),
    samples,
    cpu:
      cpu === null
        ? minute.cpu
        : minute.cpu === null
          ? cpu
          : minute.cpu + (cpu - minute.cpu) / samples,
    memory: share(sample.memory) ?? minute.memory,
    battery: share(sample.battery) ?? minute.battery,
    charging: sample.charging ?? minute.charging,
    lid: sample.lid === false || minute.lid === false ? false : (sample.lid ?? minute.lid),
    locked:
      sample.locked === true || minute.locked === true ? true : (sample.locked ?? minute.locked),
  }
}

export class MinuteFold {
  private current: Minute | null = null

  add(sample: Sample): Minute | null {
    const was = this.current
    if (was?.at === minuteOf(sample.at)) {
      this.current = folded(was, sample)
      return null
    }
    this.current = folded(fresh(sample), sample)
    return was
  }

  flush(): Minute | null {
    const was = this.current
    this.current = null
    return was
  }

  get open(): Minute | null {
    return this.current
  }
}

export type Shade = 'active' | 'idle' | 'locked' | 'shut'

export function shadeOf(minute: Minute): Shade {
  if (minute.lid === false) return 'shut'
  if (minute.locked === true) return 'locked'
  return minute.active > 0 ? 'active' : 'idle'
}

export function minuteValue(value: unknown): Minute | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const number = (key: string) =>
    typeof one[key] === 'number' && Number.isFinite(one[key]) ? one[key] : null
  const flag = (key: string) => (typeof one[key] === 'boolean' ? one[key] : null)
  const at = number('at')
  if (at === null) return null
  return {
    at,
    active: Math.min(60, Math.max(0, number('active') ?? 0)),
    samples: number('samples') ?? 0,
    cpu: share(number('cpu')),
    memory: share(number('memory')),
    battery: share(number('battery')),
    charging: flag('charging'),
    lid: flag('lid'),
    locked: flag('locked'),
  }
}
