import { overlays } from './ui-kit/src/api'
import { invoke, isDesktop } from './platform/src/api'
import { IN_A_PAGE } from './ui-controls/src/api'

export const IN_PAGE = 'orden://keyboard-in-page'

const PRESSED_THROUGH = [
  'button',
  'a[href]',
  'summary',
  'select',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="slider"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
].join(', ')

const LEAVING = 300

const OWED = 1000

export function adrift(at: Element | null): boolean {
  return !at || at === document.body || at === document.documentElement || !at.isConnected
}

export function pressedThrough(at: Element): boolean {
  return at.matches(PRESSED_THROUGH)
}

const DRAGGED = new Set(['insertFromDrop', 'deleteByDrag'])

function strayed(event: InputEvent): void {
  const at = event.target
  const keyboard = document.activeElement
  if (!(at instanceof Node) || DRAGGED.has(event.inputType)) return
  if (adrift(keyboard) || at.contains(keyboard)) return
  event.preventDefault()
  getSelection()?.removeAllRanges()
}

class KeyboardHome {
  private here: HTMLElement | null = null
  private last: Element | null = null
  private lastInLayer = false
  private told = false
  private pressing = false
  private regaining = false
  private settling = 0
  private playing = false
  private moves = 0
  private played = -1

  constructor() {
    const capture = { capture: true }
    addEventListener('pointerdown', () => this.pressed(), capture)
    addEventListener('focusin', (event) => this.focused(event), capture)
    addEventListener('keydown', (event) => this.typed(event), capture)
    addEventListener('beforeinput', (event) => strayed(event), capture)
    addEventListener('blur', (event) => this.window(event, false), capture)
    addEventListener('focus', (event) => this.window(event, true), capture)
    overlays.watch(() => {
      if (overlays.depth === 0) this.settle()
    })
    if (isDesktop) {
      void invoke('keyboard_watch').catch(() => undefined)
      void import('./own-window')
        .then(({ hearHere }) => hearHere(IN_PAGE, () => void this.went()))
        .catch(() => undefined)
    }
  }

  private pressed() {
    this.moves += 1
    this.pressing = true
    setTimeout(() => (this.pressing = false))
  }

  private focused(event: FocusEvent) {
    const at = event.target
    if (!(at instanceof HTMLElement)) return

    this.moves += 1
    this.last = at
    this.lastInLayer = overlays.depth > 0
    if (this.lastInLayer || this.regaining || !document.hasFocus()) return
    if (this.pressing && pressedThrough(at)) return

    this.here = at
    this.say()
  }

  private typed(event: KeyboardEvent) {
    if (!event.isTrusted) return
    this.moves += 1
    if (overlays.depth > 0) return
    if (['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return
    this.say()
  }

  private say() {
    document.documentElement.removeAttribute(IN_A_PAGE)
    if (this.told || !isDesktop) return
    this.told = true
    void invoke('keyboard_here').catch(() => undefined)
  }

  private window(event: Event, coming: boolean) {
    if (event.target instanceof Node || this.playing) return

    if (!coming) {
      this.told = false
      if (isDesktop) void this.went()
      return
    }

    this.regaining = true
    setTimeout(() => (this.regaining = false))
    requestAnimationFrame(() => {
      if (document.hasFocus()) this.orHome()
    })
  }

  private async went() {
    const moves = this.moves
    if (!(await invoke<boolean>('keyboard_went').catch(() => false))) return
    if (moves === this.moves) this.release()
  }

  private release() {
    document.documentElement.setAttribute(IN_A_PAGE, '')
    this.told = false
    this.here = null
    if (document.hasFocus() && this.played !== this.moves) {
      this.played = this.moves
      this.playing = true
      try {
        dispatchEvent(new FocusEvent('blur'))
      } finally {
        this.playing = false
      }
    }
    const at = document.activeElement
    if (adrift(at) || !(at instanceof HTMLElement)) return
    const selection = getSelection()
    const anchor = selection?.anchorNode
    if (selection && !selection.isCollapsed && anchor && at.contains(anchor)) {
      selection.removeAllRanges()
    }
    at.blur()
  }

  private settle() {
    cancelAnimationFrame(this.settling)
    const until = performance.now() + LEAVING
    const look = (first: boolean) => {
      this.settling = requestAnimationFrame(() => {
        if (overlays.depth > 0) return
        const at = document.activeElement
        const leaving = !adrift(at) && at === this.last && this.lastInLayer
        if (first || (leaving && performance.now() < until)) {
          look(false)
          return
        }
        if (adrift(at) && (this.lastInLayer || !this.last?.isConnected)) void this.back()
      })
    }
    look(true)
  }

  private async back() {
    const paged = isDesktop && (await invoke<boolean>('keyboard_back').catch(() => false))
    if (paged) {
      setTimeout(() => {
        if (document.hasFocus()) this.orHome()
      }, OWED)
    } else this.orHome()
  }

  private orHome() {
    if (overlays.depth === 0 && adrift(document.activeElement)) this.home()
  }

  private home() {
    if (this.here?.isConnected) this.here.focus({ preventScroll: true })
  }
}

new KeyboardHome()
