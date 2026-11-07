import type { PanelSide } from './workspace.svelte'
import { readingFactor } from './direction'
import { forget, isNumber, keepJson, stored } from './stored'
import { viewport } from './viewport.svelte'

const STORAGE_KEY = 'orden:sidebar-width'
const NARROWEST = 180
const WIDEST = 520

function keyFor(side: PanelSide): string {
  return side === 'right' ? `${STORAGE_KEY}-right` : STORAGE_KEY
}

function saved(side: PanelSide): number | null {
  const width = stored(keyFor(side))
  return isNumber(width) && width >= NARROWEST && width <= WIDEST ? width : null
}

function write(side: PanelSide, width: number | null) {
  if (width === null) forget(keyFor(side))
  else keepJson(keyFor(side), width)
}

const STEP = 16

export class SidebarWidth {
  readonly narrowest = NARROWEST
  readonly widest = WIDEST

  pixels = $state<number | null>(null)

  constructor(private readonly which: () => PanelSide = () => 'left') {
    this.pixels = saved(which())
  }

  private get side(): PanelSide {
    return this.which()
  }

  private get towards(): number {
    return (this.side === 'right' ? -1 : 1) * readingFactor()
  }

  dragging = $state(false)

  private ending: (() => void) | null = null

  reset() {
    this.pixels = null
    write(this.side, null)
  }

  step(key: string, panel: HTMLElement | undefined): boolean {
    const from = this.pixels ?? panel?.getBoundingClientRect().width ?? NARROWEST

    const put = (width: number) => {
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))
      write(this.side, this.pixels)
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
    document.body.classList.add('nib-unselectable')

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
      document.body.classList.remove('nib-unselectable')
      if (this.pixels !== null) write(this.side, this.pixels)
    }

    this.ending = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
}
