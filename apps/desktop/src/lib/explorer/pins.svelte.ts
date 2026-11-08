import { movedTo, samePath } from '../space-paths'
import { keepJson, stored, stringList } from '../stored'

const PINNED = 'orden:explorer-pinned'

function read(): string[] {
  return stringList(stored(PINNED)) ?? []
}

class Pins {
  list = $state<string[]>(read())

  constructor() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    window.addEventListener('storage', (event) => {
      if (event.key === PINNED) this.list = read()
    })
  }

  has(path: string): boolean {
    return this.list.some((one) => samePath(one, path))
  }

  pin(path: string) {
    if (this.has(path)) return
    this.keep([...this.list, path])
  }

  unpin(path: string) {
    this.keep(this.list.filter((one) => !samePath(one, path)))
  }

  moved(from: string, to: string) {
    const held = read()
    const now: string[] = []
    for (const one of held) {
      const there = movedTo(one, from, to) ?? one
      if (!now.some((kept) => samePath(kept, there))) now.push(there)
    }
    if (now.length === held.length && now.every((one, at) => one === held[at])) {
      this.list = held
      return
    }
    this.keep(now)
  }

  private keep(list: string[]) {
    this.list = list
    keepJson(PINNED, list)
  }
}

export const pins = new Pins()
