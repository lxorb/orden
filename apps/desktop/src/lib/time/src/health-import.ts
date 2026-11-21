import { type FitMessage, fitTime, readFit } from './fit'
import type { Measure, Reading, Workout, Gathered } from './health'
import { SLEEP_STAGES } from './health'

const SPORTS: Record<number, string> = {
  0: 'Workout',
  1: 'Run',
  2: 'Ride',
  4: 'Gym',
  5: 'Swim',
  10: 'Training',
  11: 'Walk',
  13: 'Ski',
  15: 'Rowing',
  17: 'Hike',
  19: 'Paddling',
  21: 'E-bike',
  41: 'Golf',
  43: 'Yoga',
}
const MONITORING = 55
const STRESS = 227
const SPO2 = 269
const SLEEP = 275
const BREATH = 297
const SESSION = 18
const RECORD = 20
const WALKING = new Set([1, 6])
const number = (message: FitMessage, field: number): number | null => {
  const value = message.fields.get(field)
  return typeof value === 'number' ? value : null
}
export function gather(messages: readonly FitMessage[]): Gathered {
  const readings: Reading[] = []
  const workouts: Workout[] = []
  let last = 0
  const counted = new Map<number, number>()
  for (const message of messages) {
    const stamp = number(message, 253)
    if (stamp !== null) last = stamp
    if (message.global === MONITORING) {
      const short = number(message, 26)
      if (stamp === null && short !== null && last) last += (short - last) & 0xffff
      const at = fitTime(last)
      const heart = number(message, 27)
      if (heart !== null && heart > 0) readings.push({ kind: 'heart', at, value: heart })
      const kind = number(message, 5)
      const cycles = number(message, 3)
      if (kind !== null && cycles !== null && WALKING.has(kind)) {
        const before = counted.get(kind)
        const steps = before === undefined || cycles < before ? 0 : cycles - before
        counted.set(kind, cycles)
        if (steps > 0) readings.push({ kind: 'steps', at, value: steps })
      }
    } else if (message.global === STRESS) {
      const value = number(message, 0)
      const time = number(message, 1)
      if (value !== null && value >= 0 && value <= 100 && time !== null) {
        readings.push({ kind: 'stress', at: fitTime(time), value })
      }
    } else if (message.global === SPO2 && stamp !== null) {
      const value = number(message, 0)
      if (value !== null && value > 50 && value <= 100) readings.push({ kind: 'spo2', at: fitTime(stamp), value })
    } else if (message.global === SLEEP && stamp !== null) {
      const value = number(message, 0)
      if (value !== null && value > 0 && value < SLEEP_STAGES.length) {
        readings.push({ kind: 'sleep', at: fitTime(stamp), value })
      }
    } else if (message.global === BREATH && stamp !== null) {
      const value = number(message, 0)
      if (value !== null && value > 0) readings.push({ kind: 'breath', at: fitTime(stamp), value: value / 100 })
    } else if (message.global === RECORD && stamp !== null) {
      const heart = number(message, 3)
      if (heart !== null && heart > 0) readings.push({ kind: 'heart', at: fitTime(stamp), value: heart })
    } else if (message.global === SESSION) {
      const begin = number(message, 2)
      const elapsed = number(message, 7)
      if (begin === null || elapsed === null) continue
      const start = fitTime(begin)
      const sport = number(message, 5)
      const meters = number(message, 9)
      workouts.push({
        id: `fit-${String(start)}-${String(sport ?? 0)}`,
        sport: SPORTS[sport ?? 0] ?? 'Workout',
        start,
        end: start + elapsed,
        heart: number(message, 16),
        peak: number(message, 17),
        calories: number(message, 11),
        meters: meters === null ? null : meters / 100,
      })
    }
  }
  return { readings: perMinute(readings), workouts }
}
export function perMinute(readings: readonly Reading[]): Reading[] {
  const held = new Map<string, { kind: Measure; at: number; sum: number; count: number }>()
  for (const one of readings) {
    const at = Math.floor(one.at / 60_000) * 60_000
    const key = `${one.kind}:${String(at)}`
    const was = held.get(key)
    if (one.kind === 'steps') {
      if (was) was.sum += one.value
      else held.set(key, { kind: one.kind, at, sum: one.value, count: 1 })
      continue
    }
    if (one.kind === 'sleep') {
      held.set(key, { kind: one.kind, at, sum: one.value, count: 1 })
      continue
    }
    if (was) {
      was.sum += one.value
      was.count += 1
    } else held.set(key, { kind: one.kind, at, sum: one.value, count: 1 })
  }
  return [...held.values()]
    .map((one) => ({ kind: one.kind, at: one.at, value: one.kind === 'steps' ? one.sum : one.sum / one.count }))
    .sort((one, other) => one.at - other.at)
}
export async function gatherFiles(files: readonly File[]): Promise<Gathered & { read: number; failed: string[] }> {
  const readings: Reading[] = []
  const workouts: Workout[] = []
  const failed: string[] = []
  let read = 0
  const take = (name: string, bytes: Uint8Array) => {
    try {
      const got = gather(readFit(bytes))
      readings.push(...got.readings)
      workouts.push(...got.workouts)
      read += 1
    } catch {
      failed.push(name)
    }
  }
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (/\.zip$/i.test(file.name)) {
      const { default: JSZip } = await import('jszip')
      const walk = async (zip: InstanceType<typeof JSZip>): Promise<void> => {
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue
          if (/\.fit$/i.test(entry.name)) take(entry.name, await entry.async('uint8array'))
          else if (/\.zip$/i.test(entry.name)) await walk(await JSZip.loadAsync(await entry.async('uint8array')))
        }
      }
      await walk(await JSZip.loadAsync(bytes))
    } else take(file.name, bytes)
  }
  return { readings: perMinute(readings), workouts, read, failed }
}
