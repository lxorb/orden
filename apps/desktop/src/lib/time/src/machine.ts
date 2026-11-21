import { MINUTE } from './days'
import type { Minute } from './minutes'

const GAP = 5 * MINUTE
export interface Gap {
  from: number
  to: number
  kind: 'asleep' | 'off'
}
interface Reading {
  mean: number
  peak: number
}
export interface DeviceSum {
  battery: { now: number; low: number; high: number } | null
  onBattery: number
  charging: number
  cpu: Reading | null
  memory: Reading | null
  screenOff: number
  offline: number
  asleep: number
  off: number
}
const numbers = (list: readonly Minute[], read: (one: Minute) => number | null | undefined): number[] =>
  list.flatMap((one) => {
    const value = read(one) ?? null
    return value === null ? [] : [value]
  })
const known = (minute: Minute): boolean =>
  [minute.cpu, minute.memory, minute.battery, minute.ac, minute.screen, minute.online, minute.boot].some(
    (one) => (one ?? null) !== null,
  )
export const sensesDevice = (minutes: readonly Minute[]): boolean => minutes.some(known)
const inside = (minutes: readonly Minute[], from: number, to: number): Minute[] =>
  minutes.filter((one) => one.at >= from && one.at < to).sort((one, other) => one.at - other.at)
export function gapsIn(minutes: readonly Minute[], from: number, to: number): Gap[] {
  const held = inside(minutes, from, to).filter(known)
  const out: Gap[] = []
  for (const [index, one] of held.entries()) {
    const next = held[index + 1]
    if (!next) break
    const start = one.at + MINUTE
    if (next.at - start < GAP) continue
    const restarted = Math.abs((next.boot ?? 0) - (one.boot ?? 0)) > MINUTE && !!one.boot && !!next.boot
    out.push({ from: start, to: next.at, kind: restarted ? 'off' : 'asleep' })
  }
  return out
}
function reading(values: number[]): Reading | null {
  if (!values.length) return null
  return {
    mean: values.reduce((sum, one) => sum + one, 0) / values.length,
    peak: values.reduce((most, one) => (one > most ? one : most), 0),
  }
}
export function deviceSum(minutes: readonly Minute[], from: number, to: number): DeviceSum {
  const held = inside(minutes, from, to)
  const levels = numbers(held, (one) => one.battery)
  const gaps = gapsIn(minutes, from, to)
  const count = (test: (one: Minute) => boolean) => held.filter(test).length * MINUTE
  return {
    battery: levels.length
      ? {
          now: levels.at(-1) ?? 0,
          low: levels.reduce((least, one) => (one < least ? one : least), 1),
          high: levels.reduce((most, one) => (one > most ? one : most), 0),
        }
      : null,
    onBattery: count((one) => one.ac === false),
    charging: count((one) => one.charging === true),
    cpu: reading(numbers(held, (one) => one.cpu)),
    memory: reading(numbers(held, (one) => one.memory)),
    screenOff: count((one) => one.screen === false),
    offline: count((one) => one.online === false),
    asleep: gaps.filter((one) => one.kind === 'asleep').reduce((sum, one) => sum + one.to - one.from, 0),
    off: gaps.filter((one) => one.kind === 'off').reduce((sum, one) => sum + one.to - one.from, 0),
  }
}
export interface DeviceSlot {
  from: number
  battery: number | null
  charging: boolean
  cpu: number | null
  memory: number | null
  screenOff: boolean
  offline: boolean
}
export function deviceSlots(minutes: readonly Minute[], from: number, to: number, size: number): DeviceSlot[] {
  const count = Math.max(1, Math.ceil((to - from) / size))
  const held: Minute[][] = Array.from({ length: count }, () => [])
  for (const minute of minutes) {
    if (minute.at < from || minute.at >= to) continue
    held[Math.floor((minute.at - from) / size)]?.push(minute)
  }
  const mean = (values: number[]) => (values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : null)
  return held.map((list, index) => ({
    from: from + index * size,
    battery: numbers(list, (one) => one.battery).at(-1) ?? null,
    charging: list.some((one) => one.charging === true),
    cpu: mean(numbers(list, (one) => one.cpu)),
    memory: mean(numbers(list, (one) => one.memory)),
    screenOff: list.some((one) => one.screen === false),
    offline: list.some((one) => one.online === false),
  }))
}
