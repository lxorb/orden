import { afterQuiet } from '../platform/src/api'
import { hostKeep, cookieOf, writeCookie } from './keep'

const KEY = 'orden:local'

const COOKIE_ROOM = 3500

const SETTLE = 400

function parsed(written: string | null): Record<string, string> {
  if (!written) return {}

  try {
    const found: unknown = JSON.parse(written)
    if (typeof found !== 'object' || found === null) return {}

    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(found)) {
      if (typeof value === 'string') out[key] = value
    }

    return out
  } catch {
    return {}
  }
}

const HOST_ONLY = new Set([
  'orden:mirrors',
  'orden:recovery',
  'orden:recent',
  'orden:expanded',
  'orden:expanded-tags',
  'orden:icons',
  'orden:folder-icons',
  'orden:item-meta',
  'orden:icon-tints',
  'orden:archived',
])

export function forTheCookie(all: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([key]) => !HOST_ONLY.has(key)))
}

function underTheLimit(all: Record<string, string>): Record<string, string> {
  const bySize = Object.entries(all).sort(([, a], [, b]) => a.length - b.length)

  const out: Record<string, string> = {}
  for (const [key, value] of bySize) {
    const next = { ...out, [key]: value }
    if (encodeURIComponent(JSON.stringify(next)).length > COOKIE_ROOM) break

    out[key] = value
  }

  return out
}

class Local implements Storage {
  private readonly held = new Map<string, string>()
  private readonly later = afterQuiet(() => this.flush(), SETTLE)

  constructor(seed: Record<string, string>) {
    for (const [key, value] of Object.entries(seed)) this.held.set(key, value)
  }

  get length(): number {
    return this.held.size
  }

  key(at: number): string | null {
    return [...this.held.keys()][at] ?? null
  }

  getItem(key: string): string | null {
    return this.held.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.held.set(key, value)
    this.later()
  }

  removeItem(key: string): void {
    this.held.delete(key)
    this.later()
  }

  clear(): void {
    this.held.clear()
    this.later()
  }

  fillFrom(older: Record<string, string>): void {
    let grew = false
    for (const [key, value] of Object.entries(older)) {
      if (this.held.has(key)) continue

      this.held.set(key, value)
      grew = true
    }

    if (grew) this.later()
  }

  private flush(): void {
    const all = Object.fromEntries(this.held)
    writeCookie(KEY, JSON.stringify(underTheLimit(forTheCookie(all))))
    void hostKeep.write(KEY, JSON.stringify(all)).catch(() => undefined)
  }
}

export function installLocal(): Local {
  const local = new Local(forTheCookie(parsed(cookieOf(KEY))))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: local,
  })

  return local
}

export async function fillLocal(local: Local): Promise<void> {
  local.fillFrom(parsed(await hostKeep.read(KEY)))
}
