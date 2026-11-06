export class Heights {
  private tree: Float64Array
  private own: Float64Array
  private sum = 0

  constructor(heights: ArrayLike<number>) {
    const count = heights.length
    this.own = Float64Array.from(heights)
    this.tree = new Float64Array(count + 1)
    const tree = this.tree
    for (let i = 1; i <= count; i++) {
      const own = this.own[i - 1] ?? 0
      tree[i] = (tree[i] ?? 0) + own
      const parent = i + (i & -i)
      if (parent <= count) tree[parent] = (tree[parent] ?? 0) + (tree[i] ?? 0)
      this.sum += own
    }
  }

  get count(): number {
    return this.own.length
  }

  get total(): number {
    return this.sum
  }

  heightOf(index: number): number {
    return this.own[index] ?? 0
  }

  set(index: number, height: number): number {
    if (index < 0 || index >= this.own.length) return 0
    const delta = height - (this.own[index] ?? 0)
    if (delta === 0) return 0
    this.own[index] = height
    this.sum += delta
    for (let i = index + 1; i <= this.own.length; i += i & -i) {
      this.tree[i] = (this.tree[i] ?? 0) + delta
    }
    return delta
  }

  top(index: number): number {
    let sum = 0
    for (let i = Math.min(index, this.own.length); i > 0; i -= i & -i) sum += this.tree[i] ?? 0
    return sum
  }

  at(y: number): number {
    const count = this.own.length
    if (count === 0) return 0
    if (y <= 0) return 0
    let index = 0
    let left = y
    for (let step = 1 << Math.floor(Math.log2(count)); step > 0; step >>= 1) {
      const next = index + step
      const size = this.tree[next] ?? 0
      if (next <= count && size <= left) {
        index = next
        left -= size
      }
    }
    return Math.min(index, count - 1)
  }

  span(top: number, room: number, overscan: number): { from: number; to: number } {
    const count = this.own.length
    if (count === 0) return { from: 0, to: 0 }
    const from = this.at(top - overscan)
    const to = Math.min(count, this.at(top + room + overscan) + 1)
    return { from, to }
  }
}

export interface Anchor {
  key: string
  offset: number
}

export function anchorAt(heights: Heights, keys: readonly string[], top: number): Anchor | null {
  if (heights.count === 0) return null
  const index = heights.at(top)
  const key = keys[index]
  return key === undefined ? null : { key, offset: heights.top(index) - top }
}

export function anchored(
  heights: Heights,
  keys: readonly string[],
  anchor: Anchor | null,
): number | null {
  if (!anchor) return null
  const index = keys.indexOf(anchor.key)
  return index === -1 ? null : heights.top(index) - anchor.offset
}
