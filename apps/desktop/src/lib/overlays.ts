/** What Escape closes.
 *
 *  Everything the app puts over the note is one of these: the settings, the
 *  palette, a sheet, the version history, a menu, a dropdown inside another
 *  overlay. Escape closes the one on top, which is the last one opened - and
 *  nothing but the order they were opened in knows which that is, so they are
 *  kept as a stack rather than each asked in turn.
 *
 *  A key that reaches an empty stack was never about an overlay: Escape in the
 *  file list clears the selection, Escape in the editor steps off a picture, and
 *  Escape leaves full screen, and all three still get their turn.
 *
 *  **A popup also closes when it is pressed past.** One that says what is its own -
 *  itself, and the button that opened it - is closed by a press anywhere else, and by
 *  the window losing the focus, which is also how a press into a web page is heard:
 *  the page is a native webview whose presses never reach the app's HTML, and all it
 *  tells the app is that the keyboard went (#382). The press that opened it does not
 *  close it, and a press in a popup opened over it - a submenu, a list - closes
 *  neither. A sheet says nothing of the kind, and is closed by its own scrim.
 *
 *  **And the press that closed one does not open it again.** A popup that lays a catch
 *  over the window to take the press past it - the list of spaces does - is closed on
 *  that press's way down, and the catch goes with it. On a screen the click a tap makes
 *  is aimed at where the finger was, after the catch has gone, so it reached the button
 *  under it - the one that opened the popup - and opened it again: a second tap on the
 *  space switcher never closed it on a phone (#411). A mouse's click goes to what both
 *  halves of the press were over, and never did. So the click after a press that closed
 *  a popup is spent where it lands on what that popup held. See `clicked`.
 *
 *  **Only what is drawn over the note belongs here**, because the stack also decides
 *  whether a web page, a native webview, must hide. Full screen wants Escape and is
 *  a mode, so it is in `onKeydown` in App.svelte; see overlays.test.ts. */

interface Open {
  close: () => void
  /** What a press may land on without closing it, for a popup; none for a sheet. */
  holds: Holds | null
}

/** What a popup holds: whatever a press may land in and leave it open. An element, as
 *  far as being inside one goes; the ones not drawn yet are nothing. */
type Holds = () => readonly (Pick<Element, 'contains'> | null | undefined)[]

/** A press, as much of one as `pressed` reads. */
interface Pointed {
  target: EventTarget | null
}

/** As much of an Escape as this needs: enough to say the press is spent. */
interface Press {
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

class Overlays {
  private readonly stack: Open[] = []

  /** What the popups the last press closed held, until that press's click is read. */
  private shutBy: Holds[] = []

  /** Who wants to hear that the stack changed.
   *
   *  One reader, and a plain callback rather than reactive state, because this file
   *  is not a rune module and the thing that reads it is not drawing anything: a
   *  web tab's page is a native webview, which draws above every pixel of HTML in
   *  the window, so it has to be out of sight while anything of the app's is over
   *  it. Told rather than polled, because an overlay opens and closes without a
   *  press - a palette row opens the next one, Escape closes it - and a page that
   *  waited for a press stayed in front of the menu until somebody clicked
   *  something. See lib/web-tab/WebTab.svelte. */
  private readonly watchers = new Set<() => void>()

  /** Puts an overlay on top, and answers how to take it off again - so the
   *  effect that opened it can hand that straight back to Svelte. `holds` makes it a
   *  popup: what a press may land on and leave it open - the popup, and whatever
   *  opened it, so pressing that again is that button's own to answer. */
  show(close: () => void, holds?: Holds): () => void {
    const entry: Open = { close, holds: holds ?? null }
    this.stack.push(entry)
    this.said()

    return () => {
      const at = this.stack.indexOf(entry)
      if (at >= 0) this.stack.splice(at, 1)
      this.said()
    }
  }

  /** Hears about every overlay opening and closing, until it stops listening. */
  watch(tell: () => void): () => void {
    this.watchers.add(tell)
    return () => this.watchers.delete(tell)
  }

  private said() {
    for (const tell of this.watchers) tell()
  }

  /** How many are open. What the tests count. */
  get depth(): number {
    return this.stack.length
  }

  /** A press somewhere in the window: every popup on top that it is past closes, down
   *  to the first that holds it or is not a popup. Called from the window on the way
   *  down, before anything under the press can decide otherwise, and so before anything
   *  under it can open a popup either: the press that opens one - on its way down, on
   *  its way up, or as rows asked for first come back (issue #244) - has always been read
   *  by then, and never closes it. See App.svelte.
   *
   *  Read by order, not by the press's own time: a press carries the time it was taken,
   *  and one that waited behind a long task carries a time from before a popup that
   *  opened in the meantime, which its time would read as the press that opened it. */
  pressed(press: Pointed) {
    this.shutBy = []
    const target = nodeOf(press)

    for (let at = this.stack.length - 1; at >= 0; at--) {
      const one = this.stack[at]
      if (!one?.holds) return
      if (target && one.holds().some((held) => held?.contains(target))) return
      this.shutBy.push(one.holds)
      this.shut(one)
    }
  }

  /** The click a press goes on to make, read on its way down. Where the press closed a
   *  popup and the click lands on what that popup held - the button that opened it - it
   *  is spent, so the press that closed it does not open it again (#411). Any other
   *  click, and every click after the next press, is left alone. */
  clicked(click: Pointed & Press) {
    const shut = this.shutBy
    this.shutBy = []
    const target = nodeOf(click)
    if (!target || !shut.some((holds) => holds().some((held) => held?.contains(target)))) return

    click.preventDefault()
    click.stopImmediatePropagation()
  }

  /** The window lost the focus: to another window, or to a web page, which is the one
   *  word a press into a page sends. Every popup on top closes. */
  away() {
    for (let top = this.stack.at(-1); top?.holds; top = this.stack.at(-1)) this.shut(top)
  }

  private shut(one: Open) {
    this.stack.splice(this.stack.indexOf(one), 1)
    this.said()
    one.close()
  }

  /** Closes the one on top. Answers whether there was one, so Escape can go on
   *  to mean whatever else it means when there was not.
   *
   *  Taken off the stack here rather than left for the closing to take it off,
   *  because closing is a change to some component's state and that reaches this
   *  list a moment later: two presses in the same moment would otherwise both
   *  close the same overlay and leave the one underneath it standing.
   *
   *  Handed the press, it spends it. Other surfaces read Escape off the same
   *  window - the find bar over a note being read, and the one over a PDF, both
   *  of which know only that their own pane has the focus - and one press that
   *  closes the palette and the bar underneath it is one press closing two
   *  things. */
  escape(press?: Press): boolean {
    const top = this.stack.pop()
    if (!top) return false

    this.said()
    press?.preventDefault()
    press?.stopImmediatePropagation()
    top.close()
    return true
  }
}

/** What a press landed on, where it is a node at all. */
function nodeOf(press: Pointed): Node | null {
  return typeof Node !== 'undefined' && press.target instanceof Node ? press.target : null
}

export const overlays = new Overlays()
