import type { Scheme } from '../theme.svelte'
import { rules } from '../themes/sample'
import { declarationsOf } from '../themes/validate'

export interface Look {
  ground: string
  side: string
  frame: string
  text: string
  muted: string
  line: string
  accent: string
  open: string
  picture: string
  scrim: string
  floor: string
  dim: string
}

interface Stated {
  name: string
  value: string
  body: boolean
  important: boolean
  weight: number
  scheme: Scheme | null
}

function aimOf(selector: string): { body: boolean; weight: number; scheme: Scheme | null } | null {
  const bare = selector.replace(/['"\s]/g, '').toLowerCase()
  if (bare === 'body') return { body: true, weight: 1, scheme: null }

  const found = /^(:root|html)?(?:\[data-theme=(dark|light)\])?$/.exec(bare)
  if (!found || bare === '') return null

  const [, root, scheme] = found
  const weight = (root === ':root' ? 10 : root === 'html' ? 1 : 0) + (scheme ? 10 : 0)
  return { body: false, weight, scheme: scheme === 'dark' || scheme === 'light' ? scheme : null }
}

const read = new Map<string, Stated[]>()

function statedIn(sheet: string): Stated[] {
  const held = read.get(sheet)
  if (held) return held

  const found: Stated[] = []
  for (const rule of rules(sheet)) {
    const aims = rule.prelude.split(',').map(aimOf)

    for (const [name, written] of declarationsOf(rule.body)) {
      if (!name.startsWith('--')) continue

      const important = /!\s*important\s*$/i.test(written)
      const value = written.replace(/!\s*important\s*$/i, '').trim()
      for (const aim of aims) if (aim) found.push({ name, value, important, ...aim })
    }
  }

  read.set(sheet, found)
  return found
}

export function argumentsOf(value: string, from: number): { end: number; comma: number } {
  let depth = 0
  let comma = -1

  for (let at = from; at < value.length; at++) {
    const letter = value[at]
    if (letter === '(') depth++
    else if (letter === ')' && --depth === 0) return { end: at, comma }
    else if (letter === ',' && depth === 1 && comma < 0) comma = at
  }

  return { end: value.length, comma }
}

export function substituted(value: string, known: Map<string, string>, depth = 0): string | null {
  const start = value.indexOf('var(')
  if (start < 0) return value
  if (depth > 10) return null

  const { end, comma } = argumentsOf(value, start + 3)
  const name = value.slice(start + 4, comma < 0 ? end : comma).trim()
  const fallback = comma < 0 ? null : value.slice(comma + 1, end).trim()
  const named = known.get(name)

  const inner =
    named !== undefined
      ? substituted(named, known, depth + 1)
      : fallback === null
        ? null
        : substituted(fallback, known, depth + 1)
  const rest = substituted(value.slice(end + 1), known, depth)
  if (inner === null || rest === null) return null

  return `${value.slice(0, start)}${inner}${rest}`
}

function winners(stated: Stated[]): Map<string, string> {
  const rank = (one: Stated) => (one.important ? 1000 : 0) + one.weight
  const best = new Map<string, Stated>()

  for (const one of stated) {
    const held = best.get(one.name)
    if (!held || rank(one) >= rank(held)) best.set(one.name, one)
  }

  return new Map([...best].map(([name, one]) => [name, one.value]))
}

function resolved(own: Map<string, string>, inherited = new Map<string, string>()) {
  const known = new Map([...inherited, ...own])
  const out = new Map(inherited)

  for (const [name, value] of own) {
    const one = substituted(value, known)
    if (one === null) out.delete(name)
    else out.set(name, one)
  }

  return out
}

export function lookOf(
  sheets: readonly string[],
  scheme: Scheme,
  inline: Readonly<Record<string, string>> = {},
): Look {
  const stated = sheets
    .flatMap(statedIn)
    .filter((one) => one.scheme === null || one.scheme === scheme)
  const written = Object.entries(inline).map(([name, value]): Stated => ({
    name,
    value,
    body: false,
    important: false,
    weight: 100,
    scheme: null,
  }))

  const root = resolved(winners([...stated.filter((one) => !one.body), ...written]))
  const body = resolved(winners(stated.filter((one) => one.body)), root)

  const token = (name: string) => body.get(name) ?? ''

  return {
    ground: token('--bg'),
    side: token('--side-bar-bg-color'),
    frame: token('--tab-frame'),
    text: token('--text'),
    muted: token('--muted'),
    line: token('--line'),
    accent: token('--accent'),
    open: token('--surface-selected'),
    picture: token('--wallpaper-picture'),
    scrim: token('--wallpaper-scrim'),
    floor: token('--wallpaper-floor'),
    dim: token('--orden-dim'),
  }
}
