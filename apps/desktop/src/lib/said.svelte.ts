/** What just happened, said out loud, once.
 *
 *  Half of what this app tells somebody it tells with a colour: the gear in the
 *  panel's foot is lit while a pass is running and red when the last one failed,
 *  the dot on a tab is amber until the note is on the disk, and a warning about
 *  storage arrives as a card in the corner. None of that reaches a reader who is
 *  listening rather than looking, and two of the three had no words anywhere in
 *  the page at all.
 *
 *  A live region is how a page says something that was not asked for, and the one
 *  thing every account of them agrees on is that the region has to be **on the
 *  page before the words are**: a region that arrives carrying its own text is a
 *  region most screen readers never announce, because there was nothing there to
 *  watch. So the region is one element in `App.svelte` that is always there and
 *  usually empty, and this is what writes into it.
 *
 *  One region and not one per notice, for the reason everything else in this app
 *  is one of a kind: three of them would be three chances to say two things at
 *  once, and a reader cannot listen to two.
 *
 *  Polite, always. Nothing this app has to say is worth cutting somebody off in
 *  the middle of a sentence they are reading: an assertive region is for a fire,
 *  and a note that has not been written down yet is not one. */

/** How long the words stay in the region before it is emptied again.
 *
 *  Emptied at all, because the same thing happening twice - a second pass that
 *  fails the same way - has to be two announcements, and a region whose text did
 *  not change is a region that says nothing. Long enough that the words are read
 *  before they go, which for a phrase is about this. */
const HELD = 4000

class Said {
  /** What the region is carrying. Empty is its resting state. */
  words = $state('')

  private clearing: ReturnType<typeof setTimeout> | undefined
  /** The last thing said, so saying it again says it again: the region is
   *  emptied first and the words are put back a beat later, which is the only
   *  way to make a live region repeat itself. */
  private last = ''

  say(words: string): void {
    const asked = words.trim()
    if (!asked) return

    clearTimeout(this.clearing)

    if (asked === this.last && this.words === asked) {
      this.words = ''
      queueMicrotask(() => (this.words = asked))
    } else {
      this.words = asked
    }

    this.last = asked
    this.clearing = setTimeout(() => (this.words = ''), HELD)
  }
}

export const said = new Said()
