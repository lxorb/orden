import { accentColour, accentFor, theme } from '../theme/src/api'
import { region, localDate } from '../platform/src/api'
import { MINUTE } from './days'
import { time } from './time.svelte'

export function tintOf(activity: string | null): string {
  const found = time.activity(activity)
  if (!found) return 'var(--muted)'
  return found.tint ? accentColour(found.tint, theme.current) : accentFor(found.name, theme.current)
}

export const placeTint = (key: string): string => accentFor(key, theme.current)

export const nameOf = (activity: string | null, none: string): string =>
  time.activity(activity)?.name ?? none

export const clock = (at: number): string => localDate(at, { hour: '2-digit', minute: '2-digit' })

const units = new Map<string, [Intl.NumberFormat, Intl.NumberFormat]>()

function unitsFor(language: string): [Intl.NumberFormat, Intl.NumberFormat] {
  const held = units.get(language)
  if (held) return held
  const made: [Intl.NumberFormat, Intl.NumberFormat] = [
    new Intl.NumberFormat(language, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }),
    new Intl.NumberFormat(language, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }),
  ]
  units.set(language, made)
  return made
}

export function length(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / MINUTE)
  const [hours, mins] = unitsFor(region())
  if (minutes < 60) return mins.format(minutes)
  const rest = minutes % 60
  const whole = hours.format(Math.floor(minutes / 60))
  return rest ? `${whole} ${mins.format(rest)}` : whole
}
