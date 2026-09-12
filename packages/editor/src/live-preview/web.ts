/** `![](https://youtube.com/watch?v=…)` and `<iframe src="…">` in the live
 *  preview: the same card the reading view and a published page show, drawn from
 *  the same markup.
 *
 *  The card is built by @nib/markdown rather than assembled here. That is the
 *  point: one design and one set of permissions, however a note is being looked
 *  at. What the editor adds is the click, which loads the frame in place instead
 *  of following the card's link out. */

import { embedClicks } from '../web-frame'
import { NibWidget } from './widget'

export class WebEmbedWidget extends NibWidget {
  /** The renderer's own markup for the card, which is built from escaped pieces
   *  and a provider table; see web-embed.ts. There is nothing of the note in it
   *  that has not been through `escape` or `attributeUrl`, which is why the
   *  markup rather than the address is what a widget holds: one card, built once,
   *  whether the note pointed at it with `![](…)` or with a tag of its own. */
  constructor(private readonly card: string) {
    super()
  }

  override eq(other: WebEmbedWidget) {
    return other.card === this.card
  }

  toDOM() {
    const holder = document.createElement('span')
    holder.innerHTML = this.card

    const card = holder.firstElementChild
    if (!(card instanceof HTMLElement)) return holder

    this.onDestroy(card, embedClicks(card))
    return card
  }

  /** The card is the widget's own, click and all. */
  override ignoreEvent() {
    return true
  }
}
