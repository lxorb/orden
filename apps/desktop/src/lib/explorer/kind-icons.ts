import { SvelteMap } from 'svelte/reactivity'
import { invoke, isDesktop } from '../tauri'
import { endingOf } from './order'

const AT_ONCE = 4

type Ask = (ending: string) => Promise<string | null>

export function kindOf(name: string): string {
  const ending = endingOf(name)
  return /^[a-z0-9_+-]{1,16}$/.test(ending) ? ending : ''
}

export class KindIcons {
  readonly #shown = new SvelteMap<string, string>()
  readonly #asked = new Set<string>()
  #waiting: string[] = []
  #running = 0
  readonly #ask: Ask | null

  constructor(ask: Ask | null) {
    this.#ask = ask
  }

  of(name: string): string | null {
    const kind = kindOf(name)
    const shown = this.#shown.get(kind)
    if (shown !== undefined) return shown
    if (this.#ask && !this.#asked.has(kind)) {
      this.#asked.add(kind)
      this.#waiting.push(kind)
      queueMicrotask(() => this.#next())
    }
    return null
  }

  #next(): void {
    const ask = this.#ask
    if (!ask) return
    while (this.#running < AT_ONCE) {
      const kind = this.#waiting.shift()
      if (kind === undefined) return
      this.#running++
      void ask(kind)
        .catch(() => null)
        .then((url) => {
          if (url) this.#shown.set(kind, url)
        })
        .finally(() => {
          this.#running--
          this.#next()
        })
    }
  }
}

export const kindIcons = new KindIcons(
  isDesktop ? (ending) => invoke<string | null>('explorer_icon', { ending }) : null,
)
