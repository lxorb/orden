export const HIDDEN = 'orden-typing'

const RULE = `.${HIDDEN} { cursor: none !important; }`

const WRITING_KEYS = new Set(['Enter', 'Backspace', 'Delete'])

const COMPOSING_KEYS = new Set(['Process', 'Dead'])

const NAMED_KEY = /^[A-Z][A-Za-z\d]+$/

const WORDLESS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

export function writes(event: KeyboardEvent, mac: boolean): boolean {
  if (event.metaKey) return false

  const altGraph = event.getModifierState('AltGraph')
  if (event.ctrlKey && !altGraph) return false
  if (event.altKey && !altGraph && !mac) return false

  const key = event.key
  return WRITING_KEYS.has(key) || COMPOSING_KEYS.has(key) || (key !== '' && !NAMED_KEY.test(key))
}

export function takesWords(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled
  if (target instanceof HTMLInputElement) {
    return !WORDLESS.has(target.type) && !target.readOnly && !target.disabled
  }
  return target instanceof HTMLElement && target.isContentEditable
}

function deepest(event: Event): Element | null {
  const first = event.composedPath()[0]
  return first instanceof Element ? first : null
}

export interface PointerWorld {
  watch(changed: () => void): () => void
  at(x: number, y: number): Element | null
}

export class TypingPointer {
  private hidden = false
  private held = false
  private touched = false
  private under: Element | null = null
  private worn: Element | null = null
  private point: { x: number; y: number } | null = null
  private unwatch: (() => void) | null = null

  constructor(
    private readonly listening: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    private readonly mac: boolean,
    private readonly world: PointerWorld | null = null,
  ) {}

  handleEvent(event: Event): void {
    switch (event.type) {
      case 'keydown':
        this.typed(event as KeyboardEvent)
        return
      case 'pointerover':
        this.over(event)
        return
      case 'pointerdown':
        this.pressed(event as PointerEvent)
        return
      case 'pointerup':
      case 'pointercancel':
        this.held = false
        return
      case 'pointermove':
        this.moved(event as PointerEvent)
        return
      case 'blur':
        this.held = false
        this.show()
        return
    }
  }

  typed(event: KeyboardEvent): void {
    if (this.hidden || this.held || this.touched) return
    if (!writes(event, this.mac) || !takesWords(event.target)) return
    if (!this.under) return

    this.hidden = true
    this.wear(this.under)
    this.listening.addEventListener('pointermove', this, true)
    this.unwatch = this.world?.watch(() => this.replaced()) ?? null
  }

  over(event: Event): void {
    this.under = deepest(event)
    const { clientX, clientY } = event as PointerEvent
    this.point = { x: clientX, y: clientY }
    if (this.hidden) this.wear(this.under)
  }

  private replaced(): void {
    if (!this.hidden || !this.point || this.worn?.isConnected !== false) return
    this.under = this.world?.at(this.point.x, this.point.y) ?? null
    this.wear(this.under)
  }

  private wear(one: Element | null): void {
    if (this.worn === one) return
    this.worn?.classList.remove(HIDDEN)
    one?.classList.add(HIDDEN)
    this.worn = one
  }

  pressed(event: PointerEvent): void {
    this.touched = event.pointerType === 'touch' || event.pointerType === 'pen'
    this.held = !this.touched
    this.show()
  }

  private at: { x: number; y: number } | null = null

  moved(event: PointerEvent): void {
    const went = this.at !== null && (event.clientX !== this.at.x || event.clientY !== this.at.y)
    if (event.movementX !== 0 || event.movementY !== 0 || went) {
      this.show()
      return
    }
    this.at ??= { x: event.clientX, y: event.clientY }
    this.over(event)
  }

  show(): void {
    if (!this.hidden) return

    this.hidden = false
    this.at = null
    this.wear(null)
    this.listening.removeEventListener('pointermove', this, true)
    this.unwatch?.()
    this.unwatch = null
  }
}

export function hidePointerWhileTyping(): () => void {
  if (!matchMedia('(any-pointer: fine)').matches) return () => undefined

  const style = document.createElement('style')
  style.textContent = RULE
  document.head.append(style)

  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)
  const pointer = new TypingPointer(window, mac, {
    watch: (changed) => {
      const watching = new MutationObserver(changed)
      watching.observe(document, { childList: true, subtree: true })
      return () => watching.disconnect()
    },
    at: (x, y) => document.elementFromPoint(x, y),
  })
  const events = ['keydown', 'pointerover', 'pointerdown', 'pointerup', 'pointercancel'] as const
  for (const one of events) window.addEventListener(one, pointer, true)
  window.addEventListener('blur', pointer)

  return () => {
    pointer.show()
    for (const one of events) window.removeEventListener(one, pointer, true)
    window.removeEventListener('blur', pointer)
    style.remove()
  }
}
