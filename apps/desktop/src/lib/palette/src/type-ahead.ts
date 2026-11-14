import { takesWords } from '../../typing-pointer'

export const TYPED_AHEAD_FOR = 400

const NAMED_KEY = /^[A-Z][A-Za-z\d]+$/

const ASKING = '[role="dialog"], [role="alertdialog"], dialog'

export interface Hands {
  listen(on: boolean, to: EventListenerObject): void
  focused(): Element | null
  put(into: Element, text: string, enter: boolean): void
}

export class TypeAhead {
  private text = ''
  private enter = false
  private on = false
  private from: Element | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly hands: Hands) {}

  hold(from: Element | null): void {
    this.end()
    const at = this.hands.focused()
    if (takesWords(at) && !from?.contains(at)) return
    this.on = true
    this.from = from
    this.hands.listen(true, this)
    this.timer = setTimeout(() => this.arrived(this.hands.focused()), TYPED_AHEAD_FOR)
  }

  letGo(into: Element | null): void {
    if (this.on) this.arrived(into)
  }

  handleEvent(event: Event): void {
    if (!this.on) return
    if (event.type === 'focusin') {
      if (this.asking(event.target)) this.arrived(event.target as Element)
      return
    }
    if (event.type !== 'keydown') return
    const at = this.hands.focused()
    if (!takesWords(at)) return
    if (this.asking(at)) {
      this.arrived(at)
      return
    }
    const press = event as KeyboardEvent
    if (press.ctrlKey || press.metaKey || (press.altKey && !press.getModifierState('AltGraph'))) {
      return
    }
    if (press.key === 'Enter') this.enter = true
    else if (press.key === 'Backspace' && !this.enter) this.text = this.text.slice(0, -1)
    else if (press.key !== '' && !NAMED_KEY.test(press.key) && !this.enter) this.text += press.key
    else return
    press.preventDefault()
    press.stopImmediatePropagation()
  }

  private asking(at: EventTarget | null): boolean {
    return at instanceof Element && !this.from?.contains(at) && at.closest(ASKING) !== null
  }

  private arrived(target: Element | null): void {
    const { text, enter } = this
    this.end()
    if (!target || target !== this.hands.focused() || !takesWords(target)) return
    if (text || enter) this.hands.put(target, text, enter)
  }

  private end(): void {
    if (this.on) this.hands.listen(false, this)
    clearTimeout(this.timer)
    this.timer = undefined
    this.on = false
    this.from = null
    this.text = ''
    this.enter = false
  }
}

function typed(text: string): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only edit a field's own undo keeps
  document.execCommand('insertText', false, text)
}

export const typeAhead = new TypeAhead({
  listen: (on, to) => {
    for (const type of ['keydown', 'focusin']) {
      if (on) window.addEventListener(type, to, true)
      else window.removeEventListener(type, to, true)
    }
  },
  focused: () => document.activeElement,
  put: (into, text, enter) => {
    queueMicrotask(() => {
      if (document.activeElement !== into) return
      if (text) typed(text)
      if (!enter) return
      const press = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      if (!into.dispatchEvent(press)) return
      if (into instanceof HTMLInputElement) into.form?.requestSubmit()
      else typed('\n')
    })
  },
})
