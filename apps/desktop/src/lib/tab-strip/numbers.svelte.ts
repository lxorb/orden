import { mount, untrack } from 'svelte'
import { shortcuts } from '../shortcuts.svelte'
import { tabOverview } from '../surfaces.svelte'
import { invoke, isDesktop } from '../platform/src/api'
import { viewport } from '../viewport.svelte'
import { workspace } from '../workspace.svelte'
import { letterOf } from './letters'
import { essentialLetters } from './letters.svelte'
import { AltHold, numerals } from './numbers'
import { takenOf, type Taken } from '../web-tab/keys'
import TabNumbers from './TabNumbers.svelte'

export interface Worn {
  id: string
  label: string
  x: number
  y: number
}

class Numbers {
  worn = $state<Worn[]>([])

  private readonly hold = new AltHold()
  private frame = 0
  private following = 0
  private pageTells = isDesktop && shortcuts.platform === 'win'

  constructor() {
    const options = { capture: true, passive: true }
    addEventListener('keydown', (event) => this.down(event), { capture: true })
    addEventListener('keyup', (event) => this.up(event), options)
    for (const name of ['pointerdown', 'pointermove', 'wheel'] as const) {
      addEventListener(name, (event) => this.sense(event), options)
    }
    addEventListener(
      'blur',
      (event) => {
        if (!(event.target instanceof Element) && !this.pageTells) this.released()
      },
      options,
    )
    $effect.root(() => {
      $effect(() => {
        const front = `${workspace.panes.focusedId}:${workspace.activeTabId}:${workspace.tabs.length}`
        if (front && untrack(() => this.hold.holding)) this.place()
      })
      if (isDesktop) {
        $effect(() => {
          const letters = Object.values(essentialLetters.given).map((letter): Taken => ({
            code: `Key${letter}`,
            ctrl: false,
            shift: false,
            alt: true,
          }))
          const panes = PAGE_TAKES.flatMap((id) => {
            const one = takenOf(shortcuts.keyFor(id), shortcuts.platform)
            return one ? [one] : []
          })
          const chords = [...letters, ...panes]
          void invoke<boolean>('web_keys_take', { chords })
            .then((tells) => (this.pageTells = tells))
            .catch(() => undefined)
        })
      }
    })
    document.addEventListener('visibilitychange', () => this.released())
    if (isDesktop) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload) this.released()
        }),
      )
    }
    mount(TabNumbers, { target: document.body, props: { numbers: this } })
  }

  private down(event: KeyboardEvent) {
    const stroke = {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      altGraph: event.getModifierState('AltGraph'),
    }
    const letter = letterOf(stroke)
    const essential = letter === null ? null : essentialLetters.pathOf(letter)
    const place = this.hold.down(stroke, event.timeStamp, essential !== null)

    if (essential !== null) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat)
        void import('../essentials.svelte').then((one) => one.openEssential(essential))
    }

    if (place) this.place()
    else if (!this.hold.holding) this.clear()
  }

  private up(event: KeyboardEvent) {
    if (event.key === 'Alt' || !event.altKey) this.released(event.timeStamp)
  }

  private sense(event: PointerEvent | WheelEvent) {
    if (this.hold.sense(event.altKey, event.getModifierState('AltGraph'))) this.place()
    else if (!this.hold.holding) this.clear()
  }

  private released(now?: number) {
    this.hold.released(now)
    this.clear()
  }

  private clear() {
    cancelAnimationFrame(this.frame)
    if (this.worn.length) this.worn = []
  }

  private place() {
    this.following = FOLLOW_FRAMES
    this.follow()
  }

  private follow() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.show())
  }

  private show() {
    if (!this.hold.holding || viewport.touch) return
    if (document.querySelector('[data-spaces-open]')) return
    if (tabOverview.open) return

    const worn = [...this.tabsWorn(), ...this.essentialsWorn()]
    const moved = !same(worn, this.worn)
    if (moved) this.worn = worn
    if ((moved || moving()) && --this.following > 0) this.follow()
  }

  private tabsWorn(): Worn[] {
    const paneId = workspace.panes.focusedId
    const strip = document.querySelector(`[data-strip="${CSS.escape(paneId)}"]`)
    if (!strip) return []

    const tabs = workspace.tabsIn(paneId)
    const labels = numerals(tabs.length, (id) => shortcuts.keyFor(id), shortcuts.platform)
    const seen = strip.getBoundingClientRect()

    return tabs.flatMap((tab, at) => {
      const label = labels[at]
      const pick = strip.querySelector(`.pick[data-tab="${CSS.escape(tab.id)}"]`)
      if (!label || !pick) return []

      const face = pick.querySelector('.face')
      const box = (face?.getClientRects().length ? face : pick).getBoundingClientRect()
      if (box.right < seen.left || box.left > seen.right) return []

      return [{ id: tab.id, label, x: box.right, y: box.bottom }]
    })
  }

  private essentialsWorn(): Worn[] {
    return [...document.querySelectorAll<HTMLElement>('[data-essential-letter]')].flatMap(
      (tile) => {
        const label = tile.dataset.essentialLetter
        const box = tile.getBoundingClientRect()
        if (!label || !box.width || box.right <= 0 || box.left >= innerWidth) return []
        if (box.bottom <= 0 || box.top >= innerHeight) return []
        const x = box.right
        return [{ id: `essential:${label}`, label, x, y: box.bottom }]
      },
    )
  }
}

const FOLLOW_FRAMES = 60

function moving(): boolean {
  return [...document.querySelectorAll('[data-strip]')].some(
    (strip) =>
      typeof strip.getAnimations === 'function' &&
      strip.getAnimations({ subtree: true }).length > 0,
  )
}

function same(one: readonly Worn[], other: readonly Worn[]): boolean {
  return (
    one.length === other.length &&
    one.every((worn, at) => {
      const that = other[at]
      return (
        !!that &&
        that.id === worn.id &&
        that.label === worn.label &&
        Math.abs(that.x - worn.x) < 0.5 &&
        Math.abs(that.y - worn.y) < 0.5
      )
    })
  )
}

const PAGE_TAKES = ['pane.focus-left', 'pane.focus-down', 'pane.focus-up', 'pane.focus-right']

export const numbers = new Numbers()
