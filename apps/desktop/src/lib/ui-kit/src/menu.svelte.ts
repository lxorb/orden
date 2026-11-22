import { DIVIDER, type MenuEntry, walkableRows } from './menu-item'

export const POINTING = 'data-pointing'
interface MenuOptions {
  title?: string
  near?: boolean
  keepFocus?: boolean
  up?: boolean
  keys?: boolean
  sub?: boolean
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
  keys = $state(false)
  lit = $state(-1)
  heldAt: { x: number; y: number } | null = null
  from: Element | null = null
  private shown = 0
  private root = $state(0)
  get which(): number {
    return this.open ? this.root : 0
  }
  show(event: MouseEvent, items: MenuEntry[], options: MenuOptions = {}): number {
    event.preventDefault()
    event.stopPropagation()
    const usable = trim(items)
    if (!usable.length || options.until?.aborted) return 0
    this.items = usable
    const shown = ++this.shown
    if (!options.sub || !this.open) this.root = shown
    this.title = options.title ?? null
    this.near = !!options.near
    this.keepFocus = !!options.keepFocus
    this.up = !!options.up
    this.keys = options.keys ?? !pointing()
    this.lit = this.keys && this.keepFocus ? (walkableRows(usable)[0] ?? -1) : -1
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
    return this.root
  }
  replace(items: MenuEntry[]) {
    if (this.open) this.items = trim(items)
  }
  hide() {
    this.open = false
  }
}
function pointing(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(POINTING)
}
function openerOf(event: MouseEvent): Element | null {
  const at = event.currentTarget ?? event.target
  if (typeof Element === 'undefined' || !(at instanceof Element)) return null
  return at.closest('button, [role="button"], a[href], [aria-haspopup]')
}
export function trim<T>(items: readonly (T | typeof DIVIDER)[]): (T | typeof DIVIDER)[] {
  const groups: T[][] = [[]]
  for (const item of items) {
    if (item !== DIVIDER) groups[groups.length - 1]?.push(item)
    else if (groups[groups.length - 1]?.length) groups.push([])
  }
  const kept = groups.filter((group) => group.length)
  return kept.flatMap((group, at) => {
    const before = kept[at - 1]
    return before && before.length > 1 && group.length > 1 ? [DIVIDER, ...group] : group
  })
}
export const menu = new ContextMenu()
export type TextField = HTMLInputElement | HTMLTextAreaElement
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])
export function textFieldOf(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) return target
  return null
}
