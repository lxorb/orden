export const LEAD = 50

const SLACK = 0.5

export class Slid {
  private readonly lefts = new WeakMap<Element, number>()
  private readonly moved = new Map<string, number>()

  heard(scroller: Element, pane: string | null, at: number): void {
    const was = this.lefts.get(scroller) ?? 0
    const now = scroller.scrollLeft
    this.lefts.set(scroller, now)
    if (pane !== null && Math.abs(now - was) > SLACK) this.moved.set(pane, at)
  }

  since(pane: string, first: number): boolean {
    return (this.moved.get(pane) ?? -Infinity) >= first - LEAD
  }

  forget(): void {
    this.moved.clear()
  }
}
