export class Picking {
  ids = $state<readonly string[]>([])
  private anchor: string | null = null
  has(id: string): boolean {
    return this.ids.includes(id)
  }
  only(id: string) {
    this.ids = [id]
    this.anchor = id
  }
  toggle(id: string) {
    this.ids = this.has(id) ? this.ids.filter((one) => one !== id) : [...this.ids, id]
    this.anchor = id
  }
  range(order: readonly string[], id: string) {
    const to = order.indexOf(id)
    if (to < 0) return
    const from = this.anchor === null ? to : order.indexOf(this.anchor)
    const start = from < 0 ? to : Math.min(from, to)
    const end = from < 0 ? to : Math.max(from, to)
    this.ids = order.slice(start, end + 1)
    this.anchor ??= id
  }
  all(order: readonly string[]) {
    this.ids = [...order]
  }
  clear() {
    this.ids = []
    this.anchor = null
  }
  keep(order: readonly string[]) {
    const kept = this.ids.filter((one) => order.includes(one))
    if (kept.length !== this.ids.length) this.ids = kept
  }
}
export type Pick = 'toggle' | 'range' | 'plain'
export const pickOf = (event: MouseEvent | KeyboardEvent): Pick =>
  event.shiftKey ? 'range' : event.altKey || event.metaKey || event.ctrlKey ? 'toggle' : 'plain'
