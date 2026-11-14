import { modes } from './modes.svelte'
import { keepJson, stored, stringList } from './platform/src/api'

export const HINTS = ['drawer', 'graph', 'palette'] as const
export type Hint = (typeof HINTS)[number]

const KEY = 'orden:hints'

class Hints {
  seen = $state<Hint[]>([])

  current = $state<Hint | null>(null)

  private put: Hint[] = []
  private showing: Hint | null = null

  private wanted = new Set<Hint>()

  private settled = false

  private spent = $state(false)

  constructor() {
    this.restore()
  }

  restore() {
    this.settled = false
    this.spent = false
    this.show(null)
    this.wanted.clear()
    const list = stringList(stored(KEY)) ?? []
    this.put = HINTS.filter((one) => list.includes(one))
    this.seen = this.put
  }

  settle() {
    this.settled = true
    this.pick()
  }

  open(hint: Hint): boolean {
    if (this.seen.includes(hint)) return false
    return this.current === hint || (this.current === null && !this.spent)
  }

  want(hint: Hint, yes: boolean) {
    if (yes) this.wanted.add(hint)
    else this.wanted.delete(hint)

    if (!yes && this.showing === hint) this.show(null)
    else this.pick()
  }

  aside(hint: Hint) {
    if (this.showing === hint) this.show(null)
  }

  dismiss(hint: Hint) {
    if (this.showing === hint) this.show(null)
    if (this.put.includes(hint)) return

    this.put = [...this.put, hint]
    this.seen = this.put
    keepJson(KEY, this.put)
  }

  private pick() {
    if (!this.settled || this.spent || this.showing !== null || modes.silent) return

    const next = HINTS.find((one) => this.wanted.has(one) && !this.put.includes(one))
    if (!next) return

    this.show(next)
    this.spent = true
  }

  private show(hint: Hint | null) {
    this.showing = hint
    this.current = hint
  }
}

export const hints = new Hints()
