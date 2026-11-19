import { DIVIDER, type MenuEntry } from './menu-item'

interface MenuOptions {
  title?: string
  near?: boolean
  keepFocus?: boolean
  up?: boolean
  until?: AbortSignal
}
class ContextMenu {
  open = $state(false)
  x = $state(0)
  y = $state(0)
  items = $state<MenuEntry[]>([])
  title = $state<string | null>(null)
  near = $state(false)
  keepFocus = $state(false)
  up = $state(false)
  lit = $state(-1)
  heldAt: { x: number; y: number } | null = null
  from: Element | null = null
  private shown = 0
  show(event: MouseEvent, items: MenuEntry[], options: MenuOptions = {}) {
    event.preventDefault()
    event.stopPropagation()
    const usable = trim(items)
    if (!usable.length || options.until?.aborted) return
    this.items = usable
    const shown = ++this.shown
    this.title = options.title ?? null
    this.near = !!options.near
    this.keepFocus = !!options.keepFocus
    this.up = !!options.up
    this.lit = -1
    this.from = event.type === 'click' ? openerOf(event) : null
    const under = this.from?.getBoundingClientRect()
    this.x = under ? under.left : event.clientX
    this.y = under ? (this.up ? under.top : under.bottom) : event.clientY
    this.heldAt = event.buttons ? { x: event.clientX, y: event.clientY } : null
    this.open = true
    options.until?.addEventListener(
      'abort',
      () => {
        if (this.shown === shown) this.hide()
      },
      { once: true },
    )
  }
  replace(items: MenuEntry[]) {
    if (this.open) this.items = trim(items)
  }
  hide() {
    this.open = false
  }
}
function openerOf(event: MouseEvent): Element | null {
  const at = event.currentTarget ?? event.target
  if (typeof Element === 'undefined' || !(at instanceof Element)) return null
  return at.closest('button, [role="button"], a[href], [aria-haspopup]')
}
export function trim(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const item of items) {
    if (item === DIVIDER && (!out.length || out[out.length - 1] === DIVIDER)) continue
    out.push(item)
  }
  while (out.length && out[out.length - 1] === DIVIDER) out.pop()
  return out
}
export const menu = new ContextMenu()
export type TextField = HTMLInputElement | HTMLTextAreaElement
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])
export function textFieldOf(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) return target
  return null
}
