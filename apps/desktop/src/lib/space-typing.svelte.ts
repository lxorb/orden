import { chorded } from './ui-kit/src/api'
import { read, type Reading, typedBy, typedOn, WAIT } from './space-pick'
import { type Space, workspace } from './workspace.svelte'

export class ListTyping {
  typed = $state('')
  held = $state(false)
  readonly reading: Reading = $derived.by(() => read(this.typed, this.names()))

  private waiting: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly names: () => readonly string[],
    private readonly go: (at: number) => void,
    private readonly loose: (typed: string) => boolean = () => false,
  ) {
    addEventListener('keyup', this.release, true)
    addEventListener('blur', this.release)
  }

  readonly press = (event: KeyboardEvent): void => {
    this.held = alone(event) || (this.held && altDigit(event) !== null)
    if (!this.key(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  private readonly release = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.key === 'Alt') this.held = false
  }

  private key(event: KeyboardEvent): boolean {
    const digit = altDigit(event)
    if ((chorded(event) && digit === null) || event.isComposing) return false

    if (event.key === 'Backspace') {
      if (!this.typed) return false
      this.set(this.typed.slice(0, -1))
      return true
    }

    if (event.key === 'Enter') {
      if (!this.reading.waits) return false
      this.went(this.reading.best)
      return true
    }

    const character = digit ?? typedBy(event.key, event.code, this.typed)
    if (character === null) return false
    if (character === ' ' && !this.typed) return false

    const next =
      typedOn(this.typed, character, this.names()) ??
      (this.loose(this.typed + character) ? this.typed + character : null)
    if (next !== null) this.set(next)
    return true
  }

  stop(): void {
    clearTimeout(this.waiting)
    removeEventListener('keyup', this.release, true)
    removeEventListener('blur', this.release)
  }

  private set(typed: string) {
    clearTimeout(this.waiting)
    this.typed = typed

    const { go, waits, best } = this.reading
    if (go !== null) this.went(go)
    else if (waits) this.waiting = setTimeout(() => this.went(best), WAIT)
  }

  private went(at: number) {
    clearTimeout(this.waiting)
    if (at >= 0) this.go(at)
  }
}

function alone(event: KeyboardEvent): boolean {
  return event.key === 'Alt' && !event.ctrlKey && !event.metaKey
}

function altDigit(event: KeyboardEvent): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null
  return /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1] ?? null
}

export class SpaceTyping extends ListTyping {
  constructor(go: (space: Space) => void) {
    super(
      () => workspace.shownSpaces.map((space) => space.name),
      (at) => {
        const space = workspace.shownSpaces[at]
        if (space) go(space)
      },
    )
  }
}
