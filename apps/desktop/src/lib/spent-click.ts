/** The click a tap goes on to make, spent: what a catch does when it takes a press.
 *
 *  A popup lays a catch over the window so that a press past it closes it and does
 *  nothing else - the list of spaces does, and the quick-add pickers do. With a mouse
 *  that is what happens: the click goes to what both halves of the press were over, and
 *  the catch is gone by the time it is let go of. On a screen the click a tap makes is
 *  aimed at where the finger was, after the catch has gone, so it landed on whatever the
 *  catch had been over: the row of the file list behind the list of spaces, or the chip
 *  that opened the picker, which opened it again (#411). A catch that closes on a touch
 *  spends that click here; a mouse's press is left as it always was.
 *
 *  One click, the next one: the next press, or a moment with no click at all, lets go. */

/** How long a tap's click may come after its press, past which there was none. */
const WITHIN = 700

let armed: (() => void) | null = null

/** Spends the click the press now being read goes on to make, where the press is not a
 *  mouse's (or is, with `any`; see menu-release.ts). Called from the catch's own
 *  `pointerdown`. */
export function spendClick(press: { pointerType: string }, any = false): void {
  if ((press.pointerType === 'mouse' && !any) || armed) return

  const spend = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    done()
  }
  const timer = setTimeout(() => done(), WITHIN)
  const done = () => {
    clearTimeout(timer)
    window.removeEventListener('click', spend, true)
    window.removeEventListener('auxclick', spend, true)
    window.removeEventListener('pointerdown', done, true)
    armed = null
  }

  window.addEventListener('click', spend, true)
  window.addEventListener('auxclick', spend, true)
  // Added while this press is on its way, so it hears the next one and not this.
  window.addEventListener('pointerdown', done, true)
  armed = done
}
