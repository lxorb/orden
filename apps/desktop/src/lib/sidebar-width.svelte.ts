import type { PanelSide } from './workspace.svelte'
import { forget, isNumber, keepJson, stored } from './platform/src/api'
import { viewport } from './viewport.svelte'

const STORAGE_KEY = 'orden:sidebar-width'
const NARROWEST = 180
const WIDEST = 520

function keyFor(side: PanelSide, base: string): string {
  return side === 'right' && base === STORAGE_KEY ? `${STORAGE_KEY}-right` : base
}

function saved(side: PanelSide, base: string): number | null {
  const width = stored(keyFor(side, base))
  return isNumber(width) && width >= NARROWEST && width <= WIDEST ? width : null
}

function write(side: PanelSide, base: string, width: number | null) {
  if (width === null) forget(keyFor(side, base))
  else keepJson(keyFor(side, base), width)
}

const STEP = 16

export class SidebarWidth {
  readonly narrowest = NARROWEST
  readonly widest = WIDEST

  pixels = $state<number | null>(null)

  constructor(
    private readonly which: () => PanelSide = () => 'left',
    private readonly key = STORAGE_KEY,
  ) {
    this.pixels = saved(which(), key)
  }

  private get side(): PanelSide {
    return this.which()
  }

  private get towards(): number {
    return this.side === 'right' ? -1 : 1
  }

  dragging = $state(false)

  private ending: (() => void) | null = null

  reset() {
    this.pixels = null
    write(this.side, this.key, null)
  }

  step(key: string, panel: HTMLElement | undefined): boolean {
    const from = this.pixels ?? panel?.getBoundingClientRect().width ?? NARROWEST

    const put = (width: number) => {
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))
      write(this.side, this.key, this.pixels)
      return true
    }

    switch (key) {
      case 'ArrowLeft':
        return put(from - STEP * this.towards)
      case 'ArrowRight':
        return put(from + STEP * this.towards)
      case 'Home':
        return put(NARROWEST)
      case 'End':
        return put(WIDEST)
      case 'Enter':
      case ' ':
        this.reset()
        return true
      default:
        return false
    }
  }

  release() {
    this.ending?.()
  }

  start(event: PointerEvent, panel: HTMLElement | undefined) {
    if (viewport.touch || event.button !== 0 || !panel) return

    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) return

    const startX = event.clientX
    const from = panel.getBoundingClientRect().width

    handle.setPointerCapture(event.pointerId)
    this.dragging = true
    document.body.style.cursor = 'col-resize'
    document.body.classList.add('orden-unselectable')

    const move = (moved: PointerEvent) => {
      const moving = (moved.clientX - startX) * this.towards
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, from + moving)))
    }

    const stop = () => {
      if (!this.ending) return
      this.ending = null

      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)

      this.dragging = false
      document.body.style.cursor = ''
      document.body.classList.remove('orden-unselectable')
      if (this.pixels !== null) write(this.side, this.key, this.pixels)
    }

    this.ending = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
}
