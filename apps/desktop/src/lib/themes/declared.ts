import { key } from '../i18n.svelte'
import { DECLARES, type ThemeSetting, WRITES } from './settings'

const OFFERED = key('One of this theme’s own settings, offered by its author.')

const MOST_SETTINGS = 6
const MOST_OPTIONS = 12
const LONGEST_LABEL = 24

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/

const UNITS = new Set(['', 'px', '%', 'rem', 'em', 'deg', 'ms', 's'])

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function pieces(spec: string): string[] | null {
  const found: string[] = []
  let at = 0

  while (at < spec.length) {
    const letter = spec[at]

    if (letter === undefined || /\s/.test(letter)) {
      at++
      continue
    }

    if (letter === '"' || letter === "'") {
      const end = spec.indexOf(letter, at + 1)
      if (end < 0) return null

      found.push(spec.slice(at + 1, end))
      at = end + 1
      continue
    }

    const next = /\s/.exec(spec.slice(at))
    const end = next ? at + next.index : spec.length
    found.push(spec.slice(at, end))
    at = end
  }

  return found
}

function numberOf(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+(?:\.\d+)?$/.test(text)) return null
  return Number(text)
}

function pairs(rest: string[]): [string, string][] | null {
  if (!rest.length || rest.length % 2 || rest.length / 2 > MOST_OPTIONS) return null

  const found: [string, string][] = []
  for (let at = 0; at < rest.length; at += 2) {
    const label = rest[at] ?? ''
    const value = rest[at + 1] ?? ''
    if (!label || label.length > LONGEST_LABEL || !value) return null

    found.push([label, value])
  }

  return found
}

function writes(id: string, value: string): Record<string, string> {
  return { [`${WRITES}${id}`]: value }
}

function step(min: number, max: number): number {
  return Math.min(1, 10 ** Math.floor(Math.log10((max - min) / 20)))
}

export function settingOf(id: string, spec: string): ThemeSetting | null {
  if (!ID.test(id)) return null

  const words = pieces(spec.trim())
  if (!words) return null

  const [kind, label, ...rest] = words
  if (!label || label.length > LONGEST_LABEL) return null

  if (kind === 'range') {
    const [min, max, initial, unit = ''] = rest
    const low = numberOf(min)
    const high = numberOf(max)
    const start = numberOf(initial)

    if (low === null || high === null || start === null) return null
    if (rest.length > 4 || low >= high || start < low || start > high) return null
    if (!UNITS.has(unit)) return null

    return {
      id,
      label,
      hint: OFFERED,
      kind: 'range',
      min: low,
      max: high,
      step: step(low, high),
      unit,
      initial: start,
      paint: (value) => writes(id, `${String(value)}${unit}`),
    }
  }

  if (kind === 'switch') {
    if (rest.length !== 1 || (rest[0] !== 'on' && rest[0] !== 'off')) return null

    return {
      id,
      label,
      hint: OFFERED,
      kind: 'switch',
      initial: rest[0] === 'on',
      paint: (value) => writes(id, value === true ? '1' : '0'),
    }
  }

  if (kind === 'choice') {
    const listed = pairs(rest)
    if (!listed) return null

    return {
      id,
      label,
      hint: OFFERED,
      kind: 'choice',
      options: listed.map(([name, value]) => ({ value, label: name })),
      initial: listed[0]?.[1] ?? '',
      paint: (value) => writes(id, String(value)),
    }
  }

  if (kind === 'colour') {
    const listed = pairs(rest)
    if (!listed?.every(([, hex]) => HEX.test(hex))) return null

    return {
      id,
      label,
      hint: OFFERED,
      kind: 'colour',
      options: listed.map(([name, hex]) => ({ value: hex, name, dark: hex, light: hex })),
      initial: listed[0]?.[1] ?? '',
      paint: (value) => writes(id, String(value)),
    }
  }

  return null
}

export function readProperty(property: string): string {
  if (typeof getComputedStyle !== 'function') return ''

  try {
    return getComputedStyle(document.documentElement).getPropertyValue(property)
  } catch {
    return ''
  }
}

function namesIn(css: string): string[] {
  const found = new Set<string>()
  for (const [, id] of css.matchAll(/--orden-setting-([a-z0-9-]+)\s*:/gi)) {
    if (id) found.add(id.toLowerCase())
  }

  return [...found]
}

export function declaredIn(css: string, read: (property: string) => string): ThemeSetting[] {
  const found: ThemeSetting[] = []

  for (const id of namesIn(css)) {
    if (found.length >= MOST_SETTINGS) break

    const setting = settingOf(id, read(`${DECLARES}${id}`))
    if (setting) found.push(setting)
  }

  return found
}
