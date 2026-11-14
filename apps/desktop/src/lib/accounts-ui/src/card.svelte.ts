import { mount } from 'svelte'

interface Anchor {
  left: number
  top: number
  right: number
  bottom: number
}

class Card {
  shown = $state<{ id: string; space: string | null; at: Anchor } | null>(null)

  close(): void {
    this.shown = null
  }
}

export const card = new Card()

let mounted = false

export function showProfile(id: string, from: Element, space: string | null = null): void {
  const box = from.getBoundingClientRect()
  card.shown = {
    id,
    space,
    at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
  }
  if (mounted || __EVEN_PLUGIN__) return
  mounted = true
  void import('./ProfileCard.svelte').then((one) => mount(one.default, { target: document.body }))
}
