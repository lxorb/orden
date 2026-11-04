/** Each tab's number, shown while Alt is held: the key that brings it to the front,
 *  small and quiet at the corner of its mark, the way Office's KeyTips sit at the corner
 *  of a button. Only on the strip of the pane being worked in, because that is the strip
 *  Alt and a digit counts along; see `showTab` in shortcuts/registry.ts.
 *
 *  And each Essential's letter, at the corner of its tile, by the same hold and the same
 *  rules: Alt and the letter shows that Essential, as a plain press of its tile does
 *  (#1051). Which letter is letters.svelte.ts. A tile out of sight - the sidebar folded
 *  away, the list showing something else - wears nothing, but its letter still goes to
 *  it. One hold and one test of whether to show, for the numbers and the letters alike,
 *  and neither asks where the keyboard is: the letters show whenever the numbers do,
 *  wherever the focus is - a note, a web page, a terminal, the top bar (#1051). So in a terminal too an Essential's letter is the app's, as
 *  Alt and a digit is; Alt and any other letter is still the shell's (terminal/keys.ts).
 *
 *  On the press of Alt itself, in the frame it goes down in, as KeyTips are. Emil,
 *  2026-10-01: *"currently it just feels a bit delayed till the numbers appear when
 *  holding alt"* - a wait of 150 ms, there so that a quick Alt+3 would never flash them,
 *  was the one thing a hand noticed every time; a flash at a quick Alt+3 is the cheaper
 *  of the two. They stay for as long as Alt is held (#1053), following what is in front
 *  through every key and every switch of tab or pane, and go when it is let go of, when
 *  any key or press of the pointer says it is up, and when the window loses the keyboard.
 *  Which number, and when a hold is a hold, is numbers.ts.
 *
 *  Keys pressed inside a web tab's page are the page's, but Alt going down there, every
 *  key pressed while it is held and its release are told to the window by the crate
 *  (`told`, `meaning` and `heard_raw` in web_keys.rs), played here as the keys they were,
 *  so the numbers come over a page as they do over a note - and the keyboard going into
 *  a page, which this document hears as its own blur, is no word of Alt there. And Alt
 *  and a digit, an Essential's letter or a pane's Alt+H, J, K and L (pane-moves.ts) is
 *  taken from the page and said as itself, so it does here what it does anywhere: the
 *  letters and the panes' keys are said to the crate as they change (`web_keys_take`). Its answer is whether a page says Alt at all - `WebView2` does, and
 *  Orden's own Chromium where the X server has its input extension - and where none does
 *  that blur still puts them away, rather than leave them up over a release nobody
 *  heard. A terminal hands Alt and a digit to the app rather than to the shell
 *  (terminal/keys.ts), so it shows them too.
 *
 *  Fetched at the launch's last turn, where it listens for itself and puts its component
 *  up empty, so the first Alt after the launch has nothing left to load or build; nothing
 *  of it is in front of the first paint. */

import { mount, untrack } from 'svelte'
import { i18n } from '../i18n.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { tabOverview } from '../surfaces.svelte'
import { invoke, isDesktop } from '../tauri'
import { viewport } from '../viewport.svelte'
import { workspace } from '../workspace.svelte'
import { letterOf } from './letters'
import { essentialLetters } from './letters.svelte'
import { AltHold, numerals } from './numbers'
import { takenOf, type Taken } from '../web-tab/keys'
import TabNumbers from './TabNumbers.svelte'

/** One tab's number, and the corner of its mark on the glass. */
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
  /** Whether a web page says Alt held and let go of inside it; see the top of this file.
   *  `WebView2` always does, and the crate's answer to the letters says for the rest. */
  private pageTells = isDesktop && shortcuts.platform === 'win'

  constructor() {
    // Capturing, so a terminal or a list that stops a key on its way cannot hide it.
    const options = { capture: true, passive: true }
    // Not passive: Alt and an Essential's letter is taken from whatever is focused.
    addEventListener('keydown', (event) => this.down(event), { capture: true })
    addEventListener('keyup', (event) => this.up(event), options)
    // Every press and move of the pointer says whether Alt is down, which is the
    // correction for a release, or a press, the window did not hear.
    for (const name of ['pointerdown', 'pointermove', 'wheel'] as const) {
      addEventListener(name, (event) => this.sense(event), options)
    }
    // The window's own blur, and not a field's, which the capturing turn hears too: the
    // keyboard gone into a web page, which says nothing of Alt there but on `WebView2`.
    addEventListener(
      'blur',
      (event) => {
        if (!(event.target instanceof Element) && !this.pageTells) this.released()
      },
      options,
    )
    // Another tab or pane in front while Alt is held, by the pointer as well as by a
    // key: the numbers go to the strip in use now, at once.
    $effect.root(() => {
      $effect(() => {
        const front = `${workspace.panes.focusedId}:${workspace.activeTabId}:${workspace.tabs.length}`
        if (front && untrack(() => this.hold.holding)) this.place()
      })
      // The Essentials' letters, and the panes' Alt+H, J, K and L where they are bound
      // now (#1033), taken from a page as they change; see the top.
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
    // The window losing the keyboard while it is in a web page, which this document is
    // not told of: it lost the keyboard to the page already. Alt+Tab is that.
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

  /** Only Alt's own release, or a key let go of once Alt is: a digit let go of with Alt
   *  still down is a hand on its way to the next one. */
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

  /** Read where the tabs are at the next frame, before it is painted: by then a digit's
   *  tab is in front and its strip has scrolled to it, which this key's own handlers,
   *  after this one, are what do. */
  private place() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.show())
  }

  private show() {
    if (!this.hold.holding || viewport.touch) return
    // Never beside a list of spaces, whose rows wear numbers of their own that a digit
    // there switches by: two sets of figures on the glass at once would be one too many
    // to read. See SpacePlace.svelte.
    if (document.querySelector('[data-spaces-open]')) return
    // Nor over the tab overview, whose windows the tabs are while it is up (#331).
    if (tabOverview.open) return

    this.worn = [...this.tabsWorn(), ...this.essentialsWorn()]
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

      // The mark where the tab shows one, and the tab's own box where it is too narrow
      // to: a tab scrolled out of the strip wears nothing.
      const face = pick.querySelector('.face')
      const box = (face?.getClientRects().length ? face : pick).getBoundingClientRect()
      if (box.right < seen.left || box.left > seen.right) return []

      return [{ id: tab.id, label, x: i18n.factor > 0 ? box.right : box.left, y: box.bottom }]
    })
  }

  /** The Essentials' letters, on the tiles in sight: a folded sidebar's are not. */
  private essentialsWorn(): Worn[] {
    return [...document.querySelectorAll<HTMLElement>('[data-essential-letter]')].flatMap(
      (tile) => {
        const label = tile.dataset.essentialLetter
        const box = tile.getBoundingClientRect()
        if (!label || !box.width || box.right <= 0 || box.left >= innerWidth) return []
        if (box.bottom <= 0 || box.top >= innerHeight) return []
        const x = i18n.factor > 0 ? box.right : box.left
        return [{ id: `essential:${label}`, label, x, y: box.bottom }]
      },
    )
  }
}

/** The app's commands whose keys are taken from a page, wherever they are bound now. */
const PAGE_TAKES = ['pane.focus-left', 'pane.focus-down', 'pane.focus-up', 'pane.focus-right']

export const numbers = new Numbers()
