import { callbacksIn, isCallbackOf, isWebUrl } from '@orden/online/urls'
import { untrack } from 'svelte'
import { openExternal } from '../../../platform/src/api'
import { webPages } from '@orden/contracts'
import { workspace } from '../../../workspace.svelte'

export type Where = 'tab' | 'system' | 'offer' | 'none'

export interface Build {
  pages: boolean
  native: boolean
}

export function whereToOpen(url: string, build: Build): Where {
  if (!isWebUrl(url)) return 'none'
  if (build.pages && build.native) return 'tab'
  if (callbacksIn(url).length) return 'none'
  return build.native ? 'system' : 'offer'
}

const A_MINUTE = 6
const AGAIN_AFTER = 3000

export class Pace {
  private times: number[] = []
  private last = { url: '', at: -Infinity }

  allows(url: string, now: number): boolean {
    if (url === this.last.url && now - this.last.at < AGAIN_AFTER) return false
    this.times = this.times.filter((at) => now - at < 60_000)
    if (this.times.length >= A_MINUTE) return false
    this.times.push(now)
    this.last = { url, at: now }
    return true
  }
}

const WATCHED_FOR = 15 * 60_000

export class Opener {
  private readonly pace = new Pace()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping; nothing renders from it
  private readonly watched = new Map<string, { stop: () => void; landed: string | null }>()

  constructor(
    private readonly terminal: () => string,
    private readonly build: Build,
    private readonly callback: (url: string) => void,
    private readonly offer: (url: string) => void,
  ) {}

  open(url: string, front: boolean, now = Date.now()): void {
    const where = whereToOpen(url, this.build)
    if (where === 'none' || !this.pace.allows(url, now)) return
    if (where === 'system') void openExternal(url)
    else if (where === 'offer') this.offer(url)
    else {
      const id = workspace.openPage(url, front ? 'front' : 'behind', this.terminal())
      if (id !== null && callbacksIn(url).length) this.watch(id, url)
    }
  }

  private watch(id: string, url: string): void {
    let sent = false
    const stop = $effect.root(() => {
      $effect(() => {
        const at = webPages().of(id).url
        const open = workspace.tabs.some((tab) => tab.id === id)
        untrack(() => {
          if (!open) {
            this.forget(id)
            return
          }
          if (sent || at === null || !isCallbackOf(url, at)) return
          sent = true
          const one = this.watched.get(id)
          if (one) one.landed = at
          this.callback(at)
        })
      })
    })
    const timer = setTimeout(() => this.forget(id), WATCHED_FOR)
    this.watched.set(id, {
      stop: () => {
        clearTimeout(timer)
        stop()
      },
      landed: null,
    })
  }

  private forget(id: string): void {
    this.watched.get(id)?.stop()
    this.watched.delete(id)
  }

  called(url: string, status: number): void {
    for (const [id, one] of this.watched) {
      if (one.landed !== url) continue
      this.forget(id)
      if (status < 200 || status >= 400) return
      workspace.close(id, false)
      workspace.activeTabId = this.terminal()
      return
    }
  }

  end(): void {
    for (const id of [...this.watched.keys()]) this.forget(id)
  }
}
