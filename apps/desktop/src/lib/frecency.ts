import { forget, isNumber, isRecord, keepJson, stored, stringList } from './stored'
import { afterQuiet } from './timing'

const KEY = 'nib:palette-picks'

const USED_KEY = 'nib:palette-used'

const DAY = 24 * 60 * 60 * 1000

export const HALF_LIFE = 7 * DAY

const MOST = 400

const SETTLING = 3000

export interface Use {
  weight: number
  at: number
}

export function worth(use: Use, now: number): number {
  return use.weight * 0.5 ** (Math.max(0, now - use.at) / HALF_LIFE)
}

export function used(before: Use | undefined, now: number): Use {
  return { weight: (before ? worth(before, now) : 0) + 1, at: now }
}

export function trimmed(uses: Map<string, Use>, now: number, most = MOST): Map<string, Use> {
  if (uses.size <= most) return uses

  const kept = [...uses].sort(([, a], [, b]) => worth(b, now) - worth(a, now)).slice(0, most)
  return new Map(kept)
}

export function usesFrom(value: unknown): Map<string, Use> {
  const out = new Map<string, Use>()
  if (!isRecord(value)) return out

  for (const [key, pair] of Object.entries(value)) {
    if (!Array.isArray(pair)) continue
    const [weight, at] = pair as unknown[]
    if (isNumber(weight) && isNumber(at) && weight > 0) out.set(key, { weight, at })
  }

  return out
}

function formerly(now: number): Map<string, Use> {
  const ids = stringList(stored(USED_KEY)) ?? []
  return new Map(ids.map((id, index) => [`command:${id}`, { weight: 1, at: now - index * 60_000 }]))
}

class Frecency {
  private uses: Map<string, Use> | null = null

  private waiting: [string, number][] = []

  private readonly settle = afterQuiet(() => this.write(), SETTLING)

  private read(): Map<string, Use> {
    if (this.uses) return this.uses

    const now = Date.now()
    let uses = usesFrom(stored(KEY))
    if (!uses.size) {
      uses = formerly(now)
      if (uses.size) this.settle()
    }
    forget(USED_KEY)

    for (const [key, at] of this.waiting) uses.set(key, used(uses.get(key), at))
    this.waiting = []
    this.uses = uses
    return uses
  }

  private write() {
    const now = Date.now()
    const uses = trimmed(this.read(), now)
    this.uses = uses

    const out: Record<string, [number, number]> = {}
    for (const [key, use] of uses) out[key] = [Math.round(use.weight * 1000) / 1000, use.at]
    keepJson(KEY, out)
  }

  use(key: string, now = Date.now()) {
    if (this.uses) this.uses.set(key, used(this.uses.get(key), now))
    else this.waiting.push([key, now])

    this.settle()
  }

  worth(key: string, now = Date.now()): number {
    const use = this.read().get(key)
    return use ? worth(use, now) : 0
  }

  last(key: string): number | null {
    return this.read().get(key)?.at ?? null
  }

  latest(prefix: string, count: number): string[] {
    return [...this.read()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, count)
      .map(([key]) => key)
  }

  forget(key: string) {
    if (this.read().delete(key)) this.settle()
  }

  flush() {
    this.settle.flush()
  }
}

export const frecency = new Frecency()
