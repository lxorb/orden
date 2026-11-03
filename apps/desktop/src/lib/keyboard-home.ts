/** Where the keyboard was in this window's own page, and the keyboard put back there.
 *
 *  Emil, 2026-09-30: coming back to nib, he had to click before he could type. The
 *  crate keeps which of the window's webviews had the keyboard and hands it back as the
 *  window comes back; see src-tauri/src/keyboard.rs. This is the other half of the same
 *  record: which element of the app's own page, and the crate told whenever a person
 *  takes the keyboard into this page, so it knows the keyboard is no longer in a site.
 *
 *  Two moments read it. **The window coming back** with nothing focused here - the
 *  engine keeps the focused element across a switch of windows, so this is a net under
 *  it - puts the keyboard back in the note, the terminal or the field it was in. **One of
 *  the app's own layers closing** - the palette, a menu, a sheet, a site's question -
 *  with the keyboard nowhere, because what had it was the layer:
 *  once the layer has gone, the keyboard goes back to the site it was in, or to the
 *  element here. A layer that put the keyboard somewhere on its way out, a note it
 *  opened or a name to type, keeps it there.
 *
 *  What is not a place the keyboard was: an element inside a layer, and a button, a tab
 *  or a link pressed with the pointer. Chrome keeps its toolbar out of the keyboard's way
 *  like this, so a menu opened over a page gives the page its typing back as it closes.
 *
 *  **A site taking the keyboard is the one handoff out of this page** (#1036). A web
 *  tab's page is a native view beside this one, and a press into it never reaches this
 *  page's HTML; all this page may hear is its window's `blur`, and on CEF on Linux it
 *  sometimes hears nothing at all. Whatever had the keyboard here - the address field
 *  with its address selected, the find bar, a menu, a note - was left looking and acting
 *  as if it still had it, and the engine focused it again, selection and all, the next
 *  time this page got the keyboard back. So the crate says it as well, from each
 *  engine, the moment a page of this window takes the keyboard (`IN_PAGE`, see
 *  src-tauri/src/keyboard.rs), and either word lands in `went`: once the crate has
 *  confirmed a page holds it, this page lets go. The window's `blur` is played for
 *  whatever listens to it if the engine never sent it, the focused element is blurred,
 *  a selection inside it is taken down, and the element is no longer where the keyboard
 *  goes home to: it is the site's now, and comes back here only with a person's press,
 *  a key or a layer of the app's own. Any control is handled by the plain DOM events it
 *  already listens to; none of them needs to know a page exists.
 *
 *  Fetched at the launch's last turn, where it listens for itself; see `warmDoors`. */

import { overlays } from './overlays'
import { invoke, isDesktop } from './tauri'
import { IN_A_PAGE } from './trap'

/** What the crate says to this window's own page as one of its sites takes the keyboard;
 *  `IN_PAGE` in src-tauri/src/keyboard.rs. */
export const IN_PAGE = 'nib://keyboard-in-page'

/** What a press lands on on its way to something else. */
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

/** How long a layer that has closed may still be in the document on its way out; the
 *  same wait as `LEAVING` in web-tab/WebTab.svelte. */
const LEAVING = 300

/** How long the crate holds the keyboard for a site still out of sight; `OWED_MS` in
 *  src-tauri/src/keyboard.rs. */
const OWED = 1000

/** Whether the keyboard is nowhere in this page. */
export function adrift(at: Element | null): boolean {
  return !at || at === document.body || at === document.documentElement || !at.isConnected
}

/** Whether a press putting the keyboard here was only on the way to something else. */
export function pressedThrough(at: Element): boolean {
  return at.matches(PRESSED_THROUGH)
}

class KeyboardHome {
  /** The element here the keyboard was last in, outside every layer. */
  private here: HTMLElement | null = null
  /** The element that took the keyboard last, layers and all, and whether a layer was up. */
  private last: Element | null = null
  private lastInLayer = false
  /** Whether the crate knows the keyboard is in this page since it last let go of it. */
  private told = false
  /** A pointer press is putting the keyboard somewhere, within its own turn. */
  private pressing = false
  /** The page is taking the keyboard back from another window, and the engine is focusing
   *  the element it kept: that is not a person choosing it. */
  private regaining = false
  private settling = 0
  /** Whether the window's `blur` going round is the one `release` plays. */
  private playing = false
  /** Counts the keyboard being used here - a press, a key, an element taking it - so a
   *  slow answer about a site having it is not acted on after it came back here, and the
   *  window's `blur` is played once each time it goes. */
  private moves = 0
  private played = -1

  constructor() {
    const capture = { capture: true }
    addEventListener('pointerdown', () => this.pressed(), capture)
    addEventListener('focusin', (event) => this.focused(event), capture)
    addEventListener('keydown', (event) => this.typed(event), capture)
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
    // A modifier alone is not typing: Alt is the first half of Alt+Tab.
    if (['Alt', 'Control', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return
    this.say()
  }

  /** The crate told, once each time this page has the keyboard again. */
  private say() {
    document.documentElement.removeAttribute(IN_A_PAGE)
    if (this.told || !isDesktop) return
    this.told = true
    void invoke('keyboard_here').catch(() => undefined)
  }

  private window(event: Event, coming: boolean) {
    // The window's own, and not an element's, which the capturing turn hears too.
    if (event.target instanceof Node || this.playing) return

    if (!coming) {
      this.told = false
      // To a site in this window, or to another program, which the crate can tell apart.
      if (isDesktop) void this.went()
      return
    }

    this.regaining = true
    setTimeout(() => (this.regaining = false))
    requestAnimationFrame(() => {
      if (document.hasFocus()) this.orHome()
    })
  }

  /** The keyboard may have gone to a site in this window: the window's `blur`, or the
   *  crate saying so. Let go of here once the crate confirms it, and not when somebody
   *  has pressed or typed here since; gone to another program, nothing is let go of,
   *  and the engine gives the element back as the window comes back. */
  private async went() {
    const moves = this.moves
    if (!(await invoke<boolean>('keyboard_went').catch(() => false))) return
    if (moves === this.moves) this.release()
  }

  /** A site has the keyboard: nothing here looks or acts as if it still had it. */
  private release() {
    document.documentElement.setAttribute(IN_A_PAGE, '')
    this.told = false
    this.here = null
    // Every popup, the tab walk, the pointer hidden while typing: whatever listens for
    // the window going hears it where the engine never said it, which is an engine that
    // still thinks this page has the keyboard.
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

  /** The last layer closed: once it has gone, the keyboard goes back if nothing took it. */
  private settle() {
    cancelAnimationFrame(this.settling)
    const until = performance.now() + LEAVING
    // A frame first, for whatever the layer opened to take the keyboard itself: the
    // caret goes into a note on the frame after it arrives; see App.svelte.
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
    // A site still out of sight under the layer takes it as it is shown again, which the
    // crate waits a second for; one that is never shown again leaves it with this page.
    if (paged) {
      setTimeout(() => {
        if (document.hasFocus()) this.orHome()
      }, OWED)
    } else this.orHome()
  }

  /** Home, if the keyboard is still nowhere in this page and nothing is over it. */
  private orHome() {
    if (overlays.depth === 0 && adrift(document.activeElement)) this.home()
  }

  private home() {
    if (this.here?.isConnected) this.here.focus({ preventScroll: true })
  }
}

new KeyboardHome()
