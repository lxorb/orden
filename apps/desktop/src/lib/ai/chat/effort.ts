import type { Api, Effort } from './types'

export const SCALE: readonly Effort[] = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (SCALE as readonly string[]).includes(value)
}

export function ordered(levels: Iterable<Effort>): Effort[] {
  const held = new Set(levels)
  held.add('auto')
  return SCALE.filter((one) => held.has(one))
}

export function wireEffort(api: Api, effort: Effort): string | null {
  if (effort === 'auto') return null
  if (api === 'anthropic') return effort === 'off' || effort === 'minimal' ? null : effort
  return effort === 'off' ? 'none' : effort
}

export function nextEffort(current: Effort, offered: readonly Effort[]): Effort {
  const levels = ordered(offered)
  const at = levels.indexOf(current)
  return levels[(at + 1) % levels.length] ?? 'auto'
}

export function nearest(refused: Effort, offered: readonly Effort[]): Effort {
  const at = SCALE.indexOf(refused)
  const left = ordered(offered).filter((one) => one !== refused && one !== 'auto')
  let best: Effort = 'auto'
  let distance = Infinity
  for (const one of left) {
    const away = Math.abs(SCALE.indexOf(one) - at)
    if (away < distance) {
      best = one
      distance = away
    }
  }
  return best
}

export function within(effort: Effort, offered: readonly Effort[]): Effort {
  return ordered(offered).includes(effort) ? effort : nearest(effort, offered)
}

export function refusesEffort(said: string, param?: string): boolean {
  if (param && /effort/i.test(param)) return true
  return /\beffort\b|reasoning[._]effort/i.test(said)
}

export function refusesReasoning(said: string, param?: string): boolean {
  if (param && /^reasoning(?:\.summary)?$/i.test(param)) return true
  return /reasoning\.summary|reasoning is not supported|does not support reasoning|unsupported parameter: 'reasoning'/i.test(
    said,
  )
}

export function supportedIn(said: string): Effort[] | null {
  const list = /supported values are:?([^.]*)/i.exec(said)?.[1]
  if (!list) return null
  const words = [...list.matchAll(/'([a-z]+)'/gi)].map((one) =>
    one[1] === 'none' ? 'off' : one[1],
  )
  const levels = words.filter(isEffort)
  return levels.length ? ordered(levels) : null
}

export function takesNoEffort(said: string, code?: string): boolean {
  return code === 'unsupported_parameter' || /unsupported parameter/i.test(said)
}
