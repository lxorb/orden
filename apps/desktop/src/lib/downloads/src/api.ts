export interface Press {
  target: Element | null
  x: number | null
  y: number | null
  at: number
}

let last: Press | null = null

export function lastPress(): Press | null {
  return last
}

function heard(event: PointerEvent | MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  const keyed = event.type === 'click' && event.detail === 0
  last = {
    target,
    x: keyed ? null : event.clientX,
    y: keyed ? null : event.clientY,
    at: performance.now(),
  }
}

let watching = false

export function watchPresses(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('pointerdown', heard, { capture: true, passive: true })
  window.addEventListener('click', heard, { capture: true, passive: true })
}

export interface Origin {
  element?: Element | null
  tab?: string
}

export function downloadStarted(name: string, from: Origin = {}): void {
  if (typeof document === 'undefined') return
  const press = last
  void import('./flight').then(
    (one) => one.started(name, from, press),
    () => undefined,
  )
}
