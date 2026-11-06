import { movedTo, relativeTo, samePath } from '../space-paths'
import { keep, storedText } from '../stored'
import { isDesktop } from '../tauri'
import type { Lock } from './protection.svelte'

const RELOCK_KEY = 'nib:protect-relock'

export const NEVER = -1
export const RELOCK_MINUTES = [0, 1, 5, 15, 60, NEVER] as const
export const DEFAULT_RELOCK = 5

function readRelock(): number {
  const said = Number(storedText(RELOCK_KEY))
  return (RELOCK_MINUTES as readonly number[]).includes(said) && storedText(RELOCK_KEY) !== null
    ? said
    : DEFAULT_RELOCK
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
    this.revision++
  }
  relock = $state(readRelock())
  private timer: ReturnType<typeof setTimeout> | null = null
  private watching = false

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
    this.watch()
  }

  close(locks: readonly Lock[]): void {
    const shut = new Set(locks.map(keyOf))
    if ([...shut].some((one) => this.open.has(one))) {
      this.open = new Set([...this.open].filter((one) => !shut.has(one)))
    }
  }

  lockAll(): void {
    this.settle()
    if (this.open.size) this.open = new Set()
  }

  setRelock(minutes: number): void {
    if (!(RELOCK_MINUTES as readonly number[]).includes(minutes)) return
    this.relock = minutes
    keep(RELOCK_KEY, String(minutes))
  }

  moved(from: string, to: string, root: string | null): void {
    if (root === null || !this.open.size) return
    const was = relativeTo(root, from)
    const now = relativeTo(root, to)
    this.open = new Set(
      [...this.open].map((one) => {
        const [at = '', key = ''] = one.split('\u0000')
        if (!key || !samePath(at, root)) return one
        const moved = movedTo(key, was, now, root)
        return moved === null ? one : keyOf({ root: at, key: moved })
      }),
    )
  }

  spaceMoved(from: string, to: string): void {
    if (!this.open.size) return
    this.open = new Set(
      [...this.open].map((one) => {
        const [at = '', key = ''] = one.split('\u0000')
        return samePath(at, from) ? keyOf({ root: to, key }) : one
      }),
    )
  }

  away(): void {
    this.settle()
    if (!this.open.size || this.relock === NEVER) return
    if (this.relock === 0) {
      this.lockAll()
      return
    }
    this.timer = setTimeout(() => this.lockAll(), this.relock * 60_000)
  }

  back(): void {
    this.settle()
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
