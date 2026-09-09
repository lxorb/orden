/** Which note the glasses are showing, and which page of it.
 *
 *  The rules, which are Emil's and are the whole of this file:
 *
 *    - the note the plugin has active is the note on the glasses;
 *    - switching notes in the plugin switches the glasses;
 *    - closing the note in the plugin leaves it on the glasses until another note
 *      becomes active, because a reader who shuts their phone has not stopped
 *      reading;
 *    - the page on the glasses and the scroll on the phone are bound both ways,
 *      and every note remembers the page it was left on;
 *    - an edit keeps the reader on the words in front of them, and a page that has
 *      not changed is not sent again.
 *
 *  All of it is synchronous state and no radio: paging a note is arithmetic now
 *  that the firmware sets its own type, so nothing here has to be a promise. What
 *  it answers is whether anything a reader can see has moved, and the caller
 *  decides what that costs. That is what makes the rules above testable rather
 *  than hopeful; there is a fake bridge for the rest. */

import { type Page, pageAt, pagesOf, type Paging } from '@nib/glasses'

/** A note the plugin has open. Keyed by the document rather than by the tab,
 *  because two panes showing one note are one note; see documents.svelte.ts. */
export interface OpenNote {
  key: string
  name: string
  text: string
}

/** What the reader is looking at, for the plugin to draw a frame around. */
export interface Showing {
  key: string
  name: string
  /** Counting from zero. */
  page: number
  count: number
  /** The region of the note this page is, which is what the frame in the plugin is
   *  drawn around and what the phone is scrolled to. */
  from: number
  to: number
  /** The lines of the note it shows. */
  firstLine: number
  lastLine: number
}

interface Shown {
  key: string
  name: string
  pages: Page[]
  page: number
}

function clamp(page: number, count: number): number {
  return Math.min(Math.max(0, page), Math.max(0, count - 1))
}

export class Session {
  private shown: Shown | null = null
  /** The page each note was left on, by document. Kept for the sitting and not
   *  written down: which page of a note somebody is on belongs to the afternoon. */
  private readonly places = new Map<string, number>()
  /** The hash of the page last put on the glass, so a page that has not changed a
   *  character is not sent again. */
  private sent = ''

  get pages(): readonly Page[] {
    return this.shown?.pages ?? []
  }

  get page(): Page | null {
    const shown = this.shown
    return shown?.pages[shown.page] ?? null
  }

  get showing(): Showing | null {
    const shown = this.shown
    const page = shown?.pages[shown.page]
    if (!shown || !page) return null

    return {
      key: shown.key,
      name: shown.name,
      page: shown.page,
      count: shown.pages.length,
      from: page.from,
      to: page.to,
      firstLine: page.firstLine,
      lastLine: page.lastLine,
    }
  }

  /** True when the page in front of the reader is not the one already on the glass.
   *
   *  Asked before anything is sent. This is the whole of what keeps a keystroke off
   *  the radio: the same words and the same page of the same count hash alike, so
   *  an edit further down the note costs nothing at all. */
  get moved(): boolean {
    return (this.page?.hash ?? '') !== this.sent
  }

  /** Remembers what is now on the glass. Called by whoever sent it. */
  drew(): void {
    this.sent = this.page?.hash ?? ''
  }

  /** The note the plugin has active, or null when it has none.
   *
   *  Null leaves the glasses as they are: that is the rule about closing a note,
   *  and it needs no state of its own, because this is only ever told what *is*
   *  active. */
  follow(open: OpenNote | null, paging: Paging): void {
    if (!open) return

    const before = this.shown
    const pages = pagesOf(open.text, paging)
    if (!pages.length) {
      // A note with nothing in it. Nothing to show, and nothing to lose either:
      // the glasses keep the last page until there is something to replace it.
      return
    }

    // A note leaving the glasses writes down the page it was left on.
    const was = before?.key === open.key ? before : null
    if (before && !was) this.places.set(before.key, before.page)

    // The same note, edited: keep the reader on the words in front of them. The
    // page they were on, wherever it moved to, since a page is its words and its
    // hash says when two are the same page. Where the page itself changed, the
    // place in the note they were at, which is the best a rewritten page allows.
    // And for another note, the page that note was left on.
    const showed = was?.pages[was.page]
    const still = showed ? pages.find((one) => one.hash === showed.hash) : undefined
    const page = still
      ? still.index
      : showed
        ? pageAt(pages, showed.from)
        : clamp(this.places.get(open.key) ?? 0, pages.length)

    const at = clamp(page, pages.length)
    this.shown = { key: open.key, name: open.name, pages, page: at }
    this.places.set(open.key, at)
  }

  /** A scroll on a temple or on the ring: one page on or back. */
  turn(by: number): void {
    const shown = this.shown
    if (!shown) return

    this.goTo(shown.page + by)
  }

  /** Straight to a page, for a spoken "open page four" and for the phone's own
   *  scroll. */
  goTo(page: number): void {
    const shown = this.shown
    if (!shown) return

    const at = clamp(page, shown.pages.length)
    shown.page = at
    this.places.set(shown.key, at)
  }

  /** The page an offset in the note falls on.
   *
   *  Half of the scroll binding: the plugin says where the top of its own viewport
   *  is in the note, and the glasses go to the page that holds it. */
  goToOffset(offset: number): void {
    const shown = this.shown
    if (!shown?.pages.length) return

    this.goTo(pageAt(shown.pages, offset))
  }

  /** Whether an offset is already on the page the reader is looking at.
   *
   *  What stops the binding chasing its own tail: the phone's scroll moves in
   *  pixels and the glasses in pages, so most of a scroll is inside the page that
   *  is already up and means nothing at all. */
  holds(offset: number): boolean {
    const page = this.page
    return page !== null && offset >= page.from && offset < page.to
  }
}
