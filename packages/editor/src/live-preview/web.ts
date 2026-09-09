/** `![](https://youtube.com/watch?v=…)` in the live preview: the same card the
 *  reading view and a published page show, drawn from the same markup.
 *
 *  The card is built by @nib/markdown rather than assembled here. That is the
 *  point: one design and one set of permissions, however a note is being looked
 *  at. What the editor adds is the click, which loads the frame in place instead
 *  of following the card's link out. */

import { webCard } from '@nib/markdown/web-embed'
import { embedClicks } from '../web-frame'
import { NibWidget } from './widget'

export class WebEmbedWidget extends NibWidget {
  constructor(private readonly address: string) {
    super()
  }

  override eq(other: WebEmbedWidget) {
    return other.address === this.address
  }

  toDOM() {
    const holder = document.createElement('span')
    // The renderer's own markup, which is built from escaped pieces and a
    // provider table; see web-embed.ts. There is nothing of the note in it that
    // has not been through `escape` or `attributeUrl`.
    holder.innerHTML = webCard(this.address) ?? ''

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
