import {
  dayOf,
  settingName,
  usageName,
  type UsageStartup,
  type UsageVia,
} from '@orden/sync-core/usage'
import { keepJson, stored } from '../stored'
import { USAGE_DAYS, usageChoice } from './choice.svelte'

export interface Tally {
  commands: Record<string, Partial<Record<UsageVia, number>>>
  features: Record<string, number>
  tabs: Record<string, number>
  settings: Record<string, Record<string, number>>
  onboarding: Record<string, number>
  startup: Partial<Record<UsageStartup, number>>
}

export type Tallies = Record<string, Tally>

const SAVED_AFTER = 2000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function emptyTally(): Tally {
  return { commands: {}, features: {}, tabs: {}, settings: {}, onboarding: {}, startup: {} }
}

let held: Tallies | null = null
let saving: ReturnType<typeof setTimeout> | undefined

export function storedTallies(): Tallies {
  const kept = stored(USAGE_DAYS)
  if (!isRecord(kept)) return {}
  const tallies: Tallies = {}
  for (const [day, one] of Object.entries(kept)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && isRecord(one)) tallies[day] = { ...emptyTally(), ...one }
  }
  return tallies
}

export function saveTallies(): void {
  clearTimeout(saving)
  saving = undefined
  if (held) keepJson(USAGE_DAYS, held)
}

export function takeTallies(before: string): Tallies {
  saveTallies()
  const all = storedTallies()
  const taken: Tallies = {}
  const left: Tallies = {}
  for (const [day, one] of Object.entries(all)) {
    if (day < before) taken[day] = one
    else left[day] = one
  }
  held = left
  keepJson(USAGE_DAYS, left)
  return taken
}

export function forgetTallies(): void {
  clearTimeout(saving)
  saving = undefined
  held = {}
}

function today(): Tally | null {
  if (!usageChoice.helping) return null
  held ??= storedTallies()
  const day = dayOf(Date.now())
  const tally = (held[day] ??= emptyTally())
  saving ??= setTimeout(saveTallies, SAVED_AFTER)
  return tally
}

function add(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by
}

export function ran(id: string | undefined, via: UsageVia): void {
  const name = id ? usageName(id) : null
  if (!name) return
  const tally = today()
  if (!tally) return
  const ways = (tally.commands[name] ??= {})
  ways[via] = (ways[via] ?? 0) + 1
}

export function changed(key: string | undefined, value: unknown): void {
  const id = key ? settingName(key) : null
  if (!id) return
  const said =
    typeof value === 'boolean' ? (value ? 'on' : 'off') : typeof value === 'string' ? value : ''
  const name = usageName(said) === said && !said.includes(':') ? said : 'other'
  const tally = today()
  if (!tally) return
  add((tally.settings[id] ??= {}), name)
}

export function stepped(step: string): void {
  const name = usageName(step)
  const tally = name ? today() : null
  if (name && tally) add(tally.onboarding, name)
}

export function spent(kind: 'features' | 'tabs', name: string, minutes = 1): void {
  const known = usageName(name)
  const tally = known ? today() : null
  if (known && tally) add(tally[kind], known, minutes)
}

export function started(bucket: UsageStartup): void {
  const tally = today()
  if (tally) tally.startup[bucket] = (tally.startup[bucket] ?? 0) + 1
}

usageChoice.changes.add(() => {
  if (!usageChoice.helping) forgetTallies()
})
