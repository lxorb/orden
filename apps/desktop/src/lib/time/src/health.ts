export type Measure = 'heart' | 'stress' | 'sleep' | 'spo2' | 'breath' | 'steps'
export const MEASURES: readonly Measure[] = ['heart', 'stress', 'sleep', 'spo2', 'breath', 'steps']
export interface Reading {
  kind: Measure
  at: number
  value: number
}
export interface Workout {
  id: string
  sport: string
  start: number
  end: number
  heart: number | null
  peak: number | null
  calories: number | null
  meters: number | null
}
export interface Gathered {
  readings: Reading[]
  workouts: Workout[]
}
export const SLEEP_STAGES = ['unknown', 'awake', 'light', 'deep', 'rem'] as const
export interface HealthSum {
  heart: { mean: number; low: number; high: number } | null
  steps: number
  sleep: { total: number; light: number; deep: number; rem: number; awake: number } | null
  stress: number | null
  spo2: { mean: number; low: number } | null
  breath: number | null
  workouts: Workout[]
}
const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : null
export function healthSum(
  readings: readonly Reading[],
  workouts: readonly Workout[],
  from: number,
  to: number,
): HealthSum {
  const inside = readings.filter((one) => one.at >= from && one.at < to)
  const of = (kind: Measure) => inside.filter((one) => one.kind === kind).map((one) => one.value)
  const hearts = [...of('heart')].sort((one, other) => one - other)
  const slept = inside.filter((one) => one.kind === 'sleep').sort((one, other) => one.at - other.at)
  const stages = slept.map((one) => one.value)
  const oxygen = of('spo2')
  const lasting = slept.map((one, index) => {
    const next = slept[index + 1]
    const gap = next ? next.at - one.at : 60_000
    return gap > 0 && gap <= 2 * 3_600_000 ? gap : 60_000
  })
  const count = (stage: number) =>
    slept.reduce((sum, one, index) => sum + (one.value === stage ? (lasting[index] ?? 0) : 0), 0)
  return {
    heart: hearts.length
      ? {
          mean: mean(hearts) ?? 0,
          low: hearts[Math.floor((hearts.length - 1) * 0.05)] ?? 0,
          high: hearts.at(-1) ?? 0,
        }
      : null,
    steps: of('steps').reduce((sum, one) => sum + one, 0),
    sleep: stages.length
      ? { total: count(2) + count(3) + count(4), light: count(2), deep: count(3), rem: count(4), awake: count(1) }
      : null,
    stress: mean(of('stress')),
    spo2: oxygen.length
      ? { mean: mean(oxygen) ?? 0, low: oxygen.reduce((least, one) => (one < least ? one : least), 100) }
      : null,
    breath: mean(of('breath')),
    workouts: workouts.filter((one) => one.end > from && one.start < to),
  }
}
export const sensesHealth = (readings: readonly Reading[], workouts: readonly Workout[]): boolean =>
  readings.length > 0 || workouts.length > 0
function slotted(readings: readonly Reading[], from: number, to: number, size: number): number[][] {
  const count = Math.max(1, Math.ceil((to - from) / size))
  const slots: number[][] = Array.from({ length: count }, () => [])
  for (const one of readings) {
    if (one.at < from || one.at >= to) continue
    slots[Math.floor((one.at - from) / size)]?.push(one.value)
  }
  return slots
}
export function healthLine(
  readings: readonly Reading[],
  from: number,
  to: number,
  size: number,
  low: number,
  high: number,
): string {
  const parts: string[] = []
  let open = false
  for (const [index, values] of slotted(readings, from, to, size).entries()) {
    const value = mean(values)
    if (value === null) {
      open = false
      continue
    }
    const x = (((index + 0.5) * size) / (to - from)) * 1000
    const y = 30 - ((Math.min(high, Math.max(low, value)) - low) / (high - low)) * 28
    parts.push(`${open ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    open = true
  }
  return parts.join(' ')
}
export function stepBars(
  readings: readonly Reading[],
  from: number,
  to: number,
  size: number,
): { from: number; count: number; share: number }[] {
  const sums = slotted(readings, from, to, size).map((values) => values.reduce((sum, one) => sum + one, 0))
  const most = sums.reduce((top, one) => (one > top ? one : top), 1)
  return sums.flatMap((count, index) => (count > 0 ? [{ from: from + index * size, count, share: count / most }] : []))
}
