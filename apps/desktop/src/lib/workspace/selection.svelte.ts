import { movedTo } from '../platform/src/api'

export class Selection {
  paths = $state<string[]>([])

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
  private readonly held = $derived(new Set(this.paths))

  private anchor: string | null = null

  has(path: string): boolean {
    return this.held.has(path)
  }

  select(path: string) {
    this.paths = [path]
    this.anchor = path
  }

  toggle(path: string) {
    this.paths = this.has(path) ? this.paths.filter((one) => one !== path) : [...this.paths, path]
    this.anchor = path
  }

  range(path: string, order: string[]) {
    const from = this.anchor === null ? -1 : order.indexOf(this.anchor)
    const to = order.indexOf(path)
    if (from < 0 || to < 0) {
      this.select(path)
      return
    }

    this.paths = order.slice(Math.min(from, to), Math.max(from, to) + 1)
  }

  extend(from: string, to: string, order: string[]) {
    if (this.anchor === null || !this.has(from)) this.anchor = from
    this.range(to, order)
  }

  all(order: string[]) {
    this.paths = order
    this.anchor = order[0] ?? null
  }

  clear() {
    this.paths = []
    this.anchor = null
  }

  moved(from: string, to: string) {
    const now = this.paths.map((path) => movedTo(path, from, to) ?? path)
    if (now.some((path, at) => path !== this.paths[at])) this.paths = now
    if (this.anchor !== null) this.anchor = movedTo(this.anchor, from, to) ?? this.anchor
  }

  spaceMoved(from: string, to: string) {
    this.moved(from, to)
  }

  gone(path: string) {
    if (this.paths.some((one) => movedTo(one, path, path) !== null)) {
      this.paths = this.paths.filter((one) => movedTo(one, path, path) === null)
    }
    if (this.anchor !== null && movedTo(this.anchor, path, path) !== null) this.anchor = null
  }

  keepOnly(exists: (path: string) => boolean) {
    if (!this.paths.length) return
    this.paths = this.paths.filter(exists)
  }

  dragging(path: string): string[] {
    return this.has(path) && this.paths.length > 1 ? [...this.paths] : [path]
  }
}

function couldHold(path: string): string[] {
  const out: string[] = []

  for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
    out.push(path.slice(0, at))
  }

  return out
}

export function outermost(paths: string[]): string[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call
  const held = new Set(paths)
  return paths.filter((path) => !couldHold(path).some((one) => held.has(one)))
}
