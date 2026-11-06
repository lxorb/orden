import { embedClicks } from '../web-frame'
import { NibWidget } from './widget'

export class WebEmbedWidget extends NibWidget {
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

  override ignoreEvent() {
    return true
  }
}
