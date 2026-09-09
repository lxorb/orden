/** Whether the card on the note is following a finger or springing into place.
 *
 *  Its own object because it is the one part of the frame that is a decision rather
 *  than a measurement, and the only part worth a test: the measuring needs an editor
 *  and a browser, and this needs a clock.
 *
 *  Three states, and the reader can tell them apart:
 *
 *  - **still**: nothing is moving, and the card sits where the page is.
 *  - **following**: a finger is dragging the note, and the card moves with the words
 *    every frame. No easing at all - a card that eases its way down a scroll lags
 *    behind the words it is supposed to be around.
 *  - **springing**: the finger let go, or the page turned on the glasses. A short
 *    spring, once, into where it belongs.
 *
 *  There is no event for a scroll that has stopped, so a moment of quiet after the
 *  last one is the whole of what "let go" can mean.
 *
 *  Whether anything is *over* the note is not here: it is read off the app's own
 *  stores and off the page, which is a measurement rather than a decision. See
 *  Glasses.svelte. */

/** How long the spring takes. The app's own duration for something that moves
 *  because something else did; see tokens.css. */
export const MOVE = 170

/** How long after the last scroll the finger is taken to have let go. Shorter than
 *  this and a slow drag springs while it is still moving. */
export const SNAP = 90

export class Frame {
  /** True while the card should be springing rather than following. What the class
   *  on the element reads. */
  moving = $state(false)
  /** True while a finger is still on the glass: a scroll arrived less than `SNAP`
   *  ago. What the card's own loop runs on - while this is true it measures every
   *  frame, off the note's own scroll, rather than waiting to be told anything.
   *
   *  Emil: *"it doesn't change WHILE scrolling but you kinda need to pause for it to
   *  react."* A scroll event is not a frame and there is no event for a scroll that
   *  is still going, so following a finger means painting on the clock rather than on
   *  the events. */
  following = $state(false)

  private settling: ReturnType<typeof setTimeout> | undefined
  private easing: ReturnType<typeof setTimeout> | undefined

  /** The note was scrolled. Following, until it goes quiet. */
  scrolled(): void {
    this.moving = false
    this.following = true
    clearTimeout(this.settling)
    clearTimeout(this.easing)

    this.settling = setTimeout(() => {
      this.following = false
      this.spring()
    }, SNAP)
  }

  /** The page on the glasses turned. Springing at once: nothing is dragging. */
  turned(): void {
    clearTimeout(this.settling)
    this.following = false
    this.spring()
  }

  private spring(): void {
    this.moving = true
    clearTimeout(this.easing)
    this.easing = setTimeout(() => {
      this.moving = false
    }, MOVE)
  }

  stop(): void {
    clearTimeout(this.settling)
    clearTimeout(this.easing)
    this.moving = false
    this.following = false
  }
}
