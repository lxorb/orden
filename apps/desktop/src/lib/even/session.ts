/** Which note the glasses are showing, and which page of it.
 *
 *  The rules, which are Emil's and are the whole of this file:
 *
 *    - the note the plugin has active is the note on the glasses;
 *    - switching notes in the plugin switches the glasses;
 *    - closing the note in the plugin leaves it on the glasses until another
 *      note becomes active, because a reader who shuts their phone has not
 *      stopped reading;
 *    - the glasses scroll on their own, by pages, and every note remembers the
 *      page it was left on;
 *    - an edit keeps the reader where they were, and sends nothing when the page
 *      they are on has not changed a pixel.
 *
 *  Nothing here knows about Svelte, a canvas or a radio: pages come from a
 *  function and go to a screen, both handed in. That is what makes the rules
 *  above testable rather than hopeful. */

import { type Page, pageAt } from '@nib/glasses'

/** A note the plugin has open. Keyed by the document rather than by the tab,
 *  because two panes showing one note are one note; see documents.svelte.ts. */
export interface OpenNote {
  key: string
  name: string
  text: string
}

/** What the reader is looking at, for the plugin to show beside the tab. */
export interface Showing {
  key: string
  name: string
  /** Counting from zero. */
  page: number
  count: number
}

/** Where a drawn page goes. */
export interface Screen {
  /** `showing` is what the page's own corner says: which page of how many. */
  show(page: Page, showing: Showing): Promise<void>
}

export type Pager = (text: string) => Promise<Page[]>

interface Shown {
  key: string
  name: string
  pages: Page[]
  page: number
}

function clamp(page: number, count: number): number {
  return Math.min(Math.max(0, page), Math.max(0, count - 1))
}

function showingOf(shown: Shown): Showing {
  return { key: shown.key, name: shown.name, page: shown.page, count: shown.pages.length }
}

export class Session {
  private shown: Shown | null = null
  /** The page each note was left on, by document. Kept for the sitting, not
   *  written down: which page of a note somebody is on belongs to the afternoon. */
  private readonly places = new Map<string, number>()
  /** Bumped by every call. A render that finishes after a newer one started has
   *  nothing to say, and sending its page would put the reader back a note. */
  private latest = 0

  constructor(
    private readonly pages: Pager,
    private readonly screen: Screen,
  ) {}

  get showing(): Showing | null {
    return this.shown ? showingOf(this.shown) : null
  }

  /** The note the plugin has active, or null when it has none.
   *
   *  Null leaves the glasses as they are. That is the rule about closing a note,
   *  and it needs no state of its own: this is only ever told what is active. */
  async follow(open: OpenNote | null): Promise<void> {
    if (!open) return

    const before = this.shown
    const mine = ++this.latest
    const pages = await this.pages(open.text)
    if (mine !== this.latest) return

    if (!pages.length) {
      // A note with nothing in it. Nothing to show, and nothing to lose either:
      // the glasses keep the last page until there is something to replace it.
      return
    }

    const edited = before !== null && before.key === open.key
    if (before !== null && !edited) this.places.set(before.key, before.page)

    // The same note, edited: keep the reader on the words they were reading,
    // which is the page that the position they were on now falls on. Another
    // note: the page it was left on.
    const showed = edited ? before.pages[before.page] : undefined
    const page = showed
      ? pageAt(pages, showed.from)
      : clamp(this.places.get(open.key) ?? 0, pages.length)

    const wanted = pages[clamp(page, pages.length)]
    if (!wanted) return

    const shown: Shown = { key: open.key, name: open.name, pages, page: wanted.index }
    this.shown = shown
    this.places.set(open.key, wanted.index)

    // Nothing moved on the page in front of them, so nothing is sent. This is
    // what keeps a keystroke off the radio.
    if (showed?.hash === wanted.hash) return

    await this.screen.show(wanted, showingOf(shown))
  }

  /** A swipe on a temple or on the ring: one page on or back.
   *
   *  Independent of the phone's own scroll on purpose. The reader is looking at
   *  the glasses, and what their thumb is doing to the phone is a different
   *  conversation. */
  async turn(by: number): Promise<void> {
    const shown = this.shown
    if (!shown) return

    const page = clamp(shown.page + by, shown.pages.length)
    if (page === shown.page) return

    const wanted = shown.pages[page]
    if (!wanted) return

    shown.page = page
    this.places.set(shown.key, page)

    // Claims the turn, so a render that started before it cannot land after it
    // and put the reader back a page.
    this.latest++
    await this.screen.show(wanted, showingOf(shown))
  }

  /** Shows the page it is already on again. What a page that has come back to
   *  the front needs: the host cleared the glasses under us. */
  async repaint(): Promise<void> {
    const shown = this.shown
    if (!shown) return

    const wanted = shown.pages[shown.page]
    if (!wanted) return

    await this.screen.show(wanted, showingOf(shown))
  }
}
