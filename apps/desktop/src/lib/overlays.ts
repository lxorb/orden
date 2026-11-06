interface Open {
  close: () => void
  holds: Holds | null
  from: Opener | null
  said: string | null
  keepsFocus: boolean
}

type Opener = Pick<Element, 'contains'> &
  Partial<Pick<Element, 'getAttribute' | 'setAttribute' | 'removeAttribute'>> & {
    focus?: () => void
  }

type Holds = () => readonly (Pick<Element, 'contains'> | null | undefined)[]

interface Pointed {
  target: EventTarget | null
}

interface Press {
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

class Overlays {
  private readonly stack: Open[] = []

  private shutBy: { holds: Holds; from: Opener | null }[] = []

  private clicking: Opener | null = null

  private readonly watchers = new Set<() => void>()

  show(
    close: () => void,
    holds?: Holds,
    from: Opener | null = this.clicking,
    keepsFocus = false,
  ): () => void {
    const entry: Open = { close, holds: holds ?? null, from, said: null, keepsFocus }
    this.stack.push(entry)
    if (from?.setAttribute) {
      entry.said = from.getAttribute?.('aria-expanded') ?? null
      from.setAttribute('aria-expanded', 'true')
    }
    this.said()

    return () => {
      const at = this.stack.indexOf(entry)
      if (at >= 0) this.stack.splice(at, 1)
      this.release(entry)
      this.said()
    }
  }

  private release(entry: Open) {
    const from = entry.from
    entry.from = null
    if (!from?.setAttribute) return
    if (entry.said === null) from.removeAttribute?.('aria-expanded')
    else from.setAttribute('aria-expanded', entry.said === 'true' ? 'false' : entry.said)
  }

  watch(tell: () => void): () => void {
    this.watchers.add(tell)
    return () => this.watchers.delete(tell)
  }

  private said() {
    for (const tell of this.watchers) tell()
  }

  get depth(): number {
    return this.stack.length
  }

  pressed(press: Pointed) {
    this.shutBy = []
    const target = nodeOf(press)

    for (let at = this.stack.length - 1; at >= 0; at--) {
      const one = this.stack[at]
      if (!one?.holds) return
      if (target && one.holds().some((held) => holds(held, target))) return
      this.shutBy.push({ holds: one.holds, from: one.from })
      this.shut(one)
    }
  }

  clicked(click: Pointed & Press) {
    const shut = this.shutBy
    this.shutBy = []
    const target = nodeOf(click)
    if (!target) return

    const landed = (held: Pick<Element, 'contains'> | null | undefined) => !!held?.contains(target)
    if (shut.some((one) => landed(one.from) || one.holds().some(landed))) {
      spend(click)
      return
    }

    let at = this.stack.length - 1
    while (at >= 0 && !landed(this.stack[at]?.from)) at--
    if (at >= 0) {
      spend(click)
      for (let top = this.stack.at(-1); top && this.stack.length > at; top = this.stack.at(-1)) {
        this.shut(top)
      }
      return
    }

    this.clicking = controlOf(target)
    if (this.clicking) setTimeout(() => (this.clicking = null), 0)
  }

  away() {
    for (let top = this.stack.at(-1); top?.holds && !top.keepsFocus; top = this.stack.at(-1))
      this.shut(top)
  }

  private shut(one: Open) {
    this.stack.splice(this.stack.indexOf(one), 1)
    this.release(one)
    this.said()
    one.close()
  }

  escape(press?: Press): boolean {
    const top = this.stack.pop()
    if (!top) return false

    const from = top.from
    this.release(top)
    this.said()
    press?.preventDefault()
    press?.stopImmediatePropagation()
    top.close()
    if (from?.focus) setTimeout(() => nowhere() && from.focus?.(), 0)
    return true
  }
}

function holds(held: Pick<Element, 'contains'> | null | undefined, target: Node): boolean {
  if (!held?.contains(target)) return false
  return held !== target || typeof getComputedStyle !== 'function' || !bare(target)
}

function bare(node: Node): boolean {
  if (typeof Element === 'undefined' || !(node instanceof Element)) return false
  const style = getComputedStyle(node)
  const none = (value: string) => value === 'none' || value === ''
  return (
    style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    none(style.backgroundImage) &&
    none(style.borderTopStyle)
  )
}

function spend(press: Press) {
  press.preventDefault()
  press.stopImmediatePropagation()
}

const CONTROL = 'button, [role="button"], a[href], summary, [aria-haspopup]'

function controlOf(target: Node): Opener | null {
  const element = typeof Element !== 'undefined' && target instanceof Element ? target : null
  return element?.closest(CONTROL) ?? null
}

function nowhere(): boolean {
  if (typeof document === 'undefined') return false
  const on = document.activeElement
  return !on || on === document.body || !on.isConnected
}

function nodeOf(press: Pointed): Node | null {
  return typeof Node !== 'undefined' && press.target instanceof Node ? press.target : null
}

export const overlays = new Overlays()
