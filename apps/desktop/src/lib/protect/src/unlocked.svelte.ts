import { heardElsewhere, movedTo, relativeTo, samePath, keep, storedText, isDesktop } from '../../platform/src/api'
import type { Lock } from './protection.svelte'

const RELOCK_KEY = 'orden:protect-relock'
export const NEVER = -1
export const RELOCK_MINUTES = [0, 1, 5, 15, 60, NEVER] as const
export const DEFAULT_RELOCK = 5

function readRelock(): number {
  const said = Number(storedText(RELOCK_KEY))
  return (RELOCK_MINUTES as readonly number[]).includes(said) && storedText(RELOCK_KEY) !== null ? said : DEFAULT_RELOCK
}

const keyOf = (lock: Pick<Lock, 'root' | 'key'>) => `${lock.root}\u0000${lock.key}`

class Unlocks {
  private opened = $state<ReadonlySet<string>>(new Set())
  revision = $state(0)

  private get open(): ReadonlySet<string> {
    return this.opened
  }

  private set open(next: ReadonlySet<string>) {
    this.opened = next
    if ([...this.agents].some((one) => !next.has(one))) {
      this.agents = new Set([...this.agents].filter((one) => next.has(one)))
    }
    this.revision++
  }

  private agents = $state<ReadonlySet<string>>(new Set())

  private session = new AbortController()

  get held(): AbortSignal {
    return this.session.signal
  }

  private shutting(): void {
    this.session.abort()
    this.session = new AbortController()
  }

  agentsMay(locks: readonly Lock[]): boolean {
    return locks.every((one) => this.has(one) && this.agents.has(keyOf(one)))
  }

  letAgents(locks: readonly Lock[], may: boolean): void {
    const keys = locks.filter((one) => this.has(one)).map(keyOf)
    this.agents = may
      ? new Set([...this.agents, ...keys])
      : new Set([...this.agents].filter((one) => !keys.includes(one)))
    this.revision++
  }
  relock = $state(readRelock())
  private timer: ReturnType<typeof setTimeout> | null = null
  private proven = false
  private grace: ReturnType<typeof setTimeout> | null = null
  private watching = false
  private wasAway = false

  get any(): boolean {
    return this.open.size > 0
  }

  has(lock: Pick<Lock, 'root' | 'key'>): boolean {
    return this.open.has(keyOf(lock))
  }

  shut(locks: readonly Lock[]): boolean {
    return locks.some((one) => !this.has(one))
  }

  unlock(locks: readonly Lock[]): void {
    if (!locks.length) return
    this.open = new Set([...this.open, ...locks.map(keyOf)])
    this.prove()
    this.watch()
  }

  stillProven(locks: readonly Lock[]): boolean {
    if (!this.proven || !locks.length) return false
    this.open = new Set([...this.open, ...locks.map(keyOf)])
    return true
  }

  private prove(): void {
    this.unprove()
    this.proven = this.relock !== 0
    if (this.proven && this.relock !== NEVER) {
      this.grace = setTimeout(() => this.unprove(), this.relock * 60_000)
    }
  }

  private unprove(): void {
    if (this.grace !== null) clearTimeout(this.grace)
    this.grace = null
    this.proven = false
  }

  close(locks: readonly Lock[]): void {
    this.unprove()
    const shut = new Set(locks.map(keyOf))
    if ([...shut].some((one) => this.open.has(one))) {
      this.open = new Set([...this.open].filter((one) => !shut.has(one)))
      this.shutting()
    }
  }

  lockAll(): void {
    this.settle()
    this.unprove()
    if (!this.open.size) return
    this.open = new Set()
    this.shutting()
  }

  setRelock(minutes: number): void {
    if (!(RELOCK_MINUTES as readonly number[]).includes(minutes)) return
    keep(RELOCK_KEY, String(minutes))
    this.retime(minutes)
  }

  private remapped(to: (one: string) => string): void {
    this.agents = new Set([...this.agents].map(to))
    this.open = new Set([...this.open].map(to))
  }

  moved(from: string, to: string, root: string | null): void {
    if (root === null || !this.open.size) return
    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    this.remapped((one) => {
      const [at = '', key = ''] = one.split('\u0000')
      if (!key || !samePath(at, root)) return one
      const moved = movedTo(key, was, now, root)
      return moved === null ? one : keyOf({ root: at, key: moved })
    })
  }

  spaceMoved(from: string, to: string): void {
    if (!this.open.size) return
    this.remapped((one) => {
      const [at = '', key = ''] = one.split('\u0000')
      return samePath(at, from) ? keyOf({ root: to, key }) : one
    })
  }

  heardRelock(): void {
    this.retime(readRelock())
  }

  private retime(minutes: number): void {
    if (minutes === this.relock) return
    this.relock = minutes
    if (this.proven) this.prove()
    if (this.wasAway) this.away()
  }

  away(): void {
    this.settle()
    this.wasAway = true
    if (!this.open.size || this.relock === NEVER) return
    if (this.relock === 0) {
      this.lockAll()
      return
    }
    this.timer = setTimeout(() => this.lockAll(), this.relock * 60_000)
  }

  back(): void {
    this.settle()
    this.wasAway = false
  }

  private settle(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private watch(): void {
    if (this.watching || typeof document === 'undefined') return
    this.watching = true
    document.addEventListener('visibilitychange', () =>
      document.visibilityState === 'hidden' ? this.away() : this.back(),
    )
    if (!isDesktop) {
      window.addEventListener('blur', () => this.away())
      window.addEventListener('focus', () => this.back())
      return
    }
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => (payload ? this.back() : this.away())),
      )
      .catch(() => undefined)
  }
}

export const unlocks = new Unlocks()

heardElsewhere([RELOCK_KEY], () => unlocks.heardRelock())
