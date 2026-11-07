import type { PassBubble } from './fill-bubble'

class PassBubbles {
  shown = $state.raw<Readonly<Record<string, PassBubble>>>({})

  of(tab: string): PassBubble | null {
    return this.shown[tab] ?? null
  }

  show(bubble: PassBubble): void {
    this.shown = { ...this.shown, [bubble.tab]: bubble }
  }

  clear(tab: string, kind?: PassBubble['kind']): void {
    const was = this.shown[tab]
    if (!was || (kind !== undefined && was.kind !== kind)) return
    this.shown = Object.fromEntries(Object.entries(this.shown).filter(([one]) => one !== tab))
  }
}

export const passBubbles = new PassBubbles()
