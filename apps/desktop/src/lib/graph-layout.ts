import type { NoteGraph } from './graph'

const DISTANCE = 36
const REPULSION = -150
const GRAVITY = 0.055
const KEPT_SPEED = 0.6
const COLD = 0.001
const TICKS = 300
const COOLING = 1 - Math.pow(COLD, 1 / TICKS)

const SETTLING_TICKS = 4
const DRAG_WARMTH = 0.3
const CARRIED_WARMTH = 0.1

const THETA_SQUARED = 0.81
const NEAREST_SQUARED = 1
const DEEPEST = 24
const IN_A_LEAF = 4

const SPIRAL = Math.PI * (3 - Math.sqrt(5))
const SPIRAL_STEP = 12

function random(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let z = Math.imul(state ^ (state >>> 15), 1 | state)
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

export interface LayoutOptions {
  seed?: number
  spread?: number
  gather?: boolean
  distance?: number
  push?: number
  from?: ReadonlyMap<string, { x: number; y: number }> | undefined
}

export class Layout {
  readonly x: Float64Array
  readonly y: Float64Array

  private readonly vx: Float64Array
  private readonly vy: Float64Array
  private readonly held: Uint8Array
  private readonly heldX: Float64Array
  private readonly heldY: Float64Array

  private readonly from: Int32Array
  private readonly to: Int32Array
  private readonly pull: Float64Array
  private readonly bias: Float64Array

  private readonly count: number
  private warmth = 1
  private readonly repulsion: number
  private readonly gravity: number
  private readonly distance: number

  constructor(graph: NoteGraph, options: LayoutOptions = {}) {
    const count = graph.nodes.length
    this.count = count
    this.repulsion = -Math.abs(options.push ?? -REPULSION) * (options.spread ?? 1)
    this.gravity = options.gather === false ? 0 : GRAVITY
    this.distance = options.distance ?? DISTANCE

    this.x = new Float64Array(count)
    this.y = new Float64Array(count)
    this.vx = new Float64Array(count)
    this.vy = new Float64Array(count)
    this.held = new Uint8Array(count)
    this.heldX = new Float64Array(count)
    this.heldY = new Float64Array(count)

    const next = random(options.seed ?? 1)
    for (let one = 0; one < count; one++) {
      const radius = SPIRAL_STEP * Math.sqrt(0.5 + one)
      const angle = one * SPIRAL + next() * 2 * Math.PI
      this.x[one] = radius * Math.cos(angle)
      this.y[one] = radius * Math.sin(angle)
    }

    if (options.from?.size) this.carry(graph, options.from, next)

    const edges = graph.edges.length
    this.from = new Int32Array(edges)
    this.to = new Int32Array(edges)
    this.pull = new Float64Array(edges)
    this.bias = new Float64Array(edges)

    for (let edge = 0; edge < edges; edge++) {
      const one = graph.edges[edge]
      if (!one) continue

      const here = Math.max(1, graph.nodes[one.a]?.degree ?? 1)
      const there = Math.max(1, graph.nodes[one.b]?.degree ?? 1)

      this.from[edge] = one.a
      this.to[edge] = one.b
      this.pull[edge] = 1 / Math.min(here, there)
      this.bias[edge] = here / (here + there)
    }

    this.stack = new Int32Array(4 * DEEPEST + 8)
    this.order = new Int32Array(count)
    this.scratch = new Int32Array(count)
    this.growCells(Math.max(8, 4 * Math.ceil(count / IN_A_LEAF) + 8))
  }

  private carry(
    graph: NoteGraph,
    from: ReadonlyMap<string, { x: number; y: number }>,
    next: () => number,
  ) {
    const known = new Uint8Array(this.count)
    for (const [one, node] of graph.nodes.entries()) {
      const was = from.get(node.id)
      if (!was) continue
      this.x[one] = was.x
      this.y[one] = was.y
      known[one] = 1
    }
    if (!known.includes(1)) return

    for (const edge of graph.edges) {
      for (const [one, other] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ] as const) {
        if (known[one] || !known[other]) continue
        const angle = next() * 2 * Math.PI
        this.x[one] = (this.x[other] ?? 0) + this.distance * Math.cos(angle)
        this.y[one] = (this.y[other] ?? 0) + this.distance * Math.sin(angle)
        known[one] = 1
      }
    }
    this.warmth = CARRIED_WARMTH
  }

  get settled(): boolean {
    return this.warmth < COLD || this.count === 0
  }

  tick(times = 1) {
    for (let step = 0; step < times && !this.settled; step++) {
      this.warmth -= this.warmth * COOLING
      this.spring(this.warmth)
      this.push(this.warmth)
      this.gather(this.warmth)
      this.move()
    }
  }

  settle(budget: number): boolean {
    const until = performance.now() + budget
    while (!this.settled && performance.now() < until) this.tick(SETTLING_TICKS)

    return this.settled
  }

  hold(node: number, x: number, y: number) {
    if (node < 0 || node >= this.count) return

    this.held[node] = 1
    this.heldX[node] = x
    this.heldY[node] = y
    this.x[node] = x
    this.y[node] = y
    if (this.warmth < DRAG_WARMTH) this.warmth = DRAG_WARMTH
  }

  private spring(warmth: number) {
    const { x, y, vx, vy, from, to, pull, bias, distance } = this

    for (let edge = 0; edge < from.length; edge++) {
      const a = from[edge] ?? 0
      const b = to[edge] ?? 0

      let dx = (x[b] ?? 0) + (vx[b] ?? 0) - ((x[a] ?? 0) + (vx[a] ?? 0))
      let dy = (y[b] ?? 0) + (vy[b] ?? 0) - ((y[a] ?? 0) + (vy[a] ?? 0))
      const length = Math.sqrt(dx * dx + dy * dy) || NEAREST_SQUARED

      const force = ((length - distance) / length) * warmth * (pull[edge] ?? 1)
      dx *= force
      dy *= force

      const share = bias[edge] ?? 0.5
      vx[b] = (vx[b] ?? 0) - dx * share
      vy[b] = (vy[b] ?? 0) - dy * share
      vx[a] = (vx[a] ?? 0) + dx * (1 - share)
      vy[a] = (vy[a] ?? 0) + dy * (1 - share)
    }
  }

  private gather(warmth: number) {
    const { x, y, vx, vy, count } = this

    if (this.gravity === 0) return

    for (let one = 0; one < count; one++) {
      vx[one] = (vx[one] ?? 0) - (x[one] ?? 0) * this.gravity * warmth
      vy[one] = (vy[one] ?? 0) - (y[one] ?? 0) * this.gravity * warmth
    }
  }

  private move() {
    const { x, y, vx, vy, held, heldX, heldY, count } = this

    for (let one = 0; one < count; one++) {
      if (held[one]) {
        x[one] = heldX[one] ?? 0
        y[one] = heldY[one] ?? 0
        vx[one] = 0
        vy[one] = 0
        continue
      }

      vx[one] = (vx[one] ?? 0) * KEPT_SPEED
      vy[one] = (vy[one] ?? 0) * KEPT_SPEED
      x[one] = (x[one] ?? 0) + (vx[one] ?? 0)
      y[one] = (y[one] ?? 0) + (vy[one] ?? 0)
    }
  }

  private readonly order: Int32Array
  private readonly scratch: Int32Array
  private readonly stack: Int32Array

  private first = new Int32Array(0)
  private inside = new Int32Array(0)
  private child = new Int32Array(0)
  private mass = new Float64Array(0)
  private middleX = new Float64Array(0)
  private middleY = new Float64Array(0)
  private width = new Float64Array(0)
  private squares = 0

  private growCells(wanted: number) {
    if (this.first.length >= wanted) return

    const size = Math.max(wanted, this.first.length * 2)
    const wider = (held: Int32Array) => {
      const grown = new Int32Array(size)
      grown.set(held)
      return grown
    }
    const widerFloat = (held: Float64Array) => {
      const grown = new Float64Array(size)
      grown.set(held)
      return grown
    }

    this.first = wider(this.first)
    this.inside = wider(this.inside)
    this.child = wider(this.child)
    this.mass = widerFloat(this.mass)
    this.middleX = widerFloat(this.middleX)
    this.middleY = widerFloat(this.middleY)
    this.width = widerFloat(this.width)
  }

  private push(warmth: number) {
    const { x, y, vx, vy, count, order, stack, child, first, inside, mass } = this
    if (count < 2) return

    this.divide()

    for (let one = 0; one < count; one++) {
      const px = x[one] ?? 0
      const py = y[one] ?? 0
      let fx = 0
      let fy = 0
      let top = 0
      stack[top++] = 0

      while (top > 0) {
        const square = stack[--top] ?? 0
        const weight = mass[square] ?? 0
        if (weight === 0) continue

        const dx = (this.middleX[square] ?? 0) - px
        const dy = (this.middleY[square] ?? 0) - py
        let far = dx * dx + dy * dy
        const side = this.width[square] ?? 0
        const base = child[square] ?? -1

        if (base >= 0 && side * side >= THETA_SQUARED * far) {
          stack[top++] = base
          stack[top++] = base + 1
          stack[top++] = base + 2
          stack[top++] = base + 3
          continue
        }

        if (base < 0) {
          const start = first[square] ?? 0
          const held = inside[square] ?? 0

          for (let step = 0; step < held; step++) {
            const other = order[start + step] ?? 0
            if (other === one) continue

            const ox = (x[other] ?? 0) - px
            const oy = (y[other] ?? 0) - py
            let apart = ox * ox + oy * oy
            if (apart < NEAREST_SQUARED) apart = NEAREST_SQUARED

            const force = (this.repulsion * warmth) / apart
            fx += ox * force
            fy += oy * force
          }
          continue
        }

        if (far < NEAREST_SQUARED) far = NEAREST_SQUARED
        const force = (this.repulsion * weight * warmth) / far
        fx += dx * force
        fy += dy * force
      }

      vx[one] = (vx[one] ?? 0) + fx
      vy[one] = (vy[one] ?? 0) + fy
    }
  }

  private divide() {
    const { x, y, count, order } = this

    let least = Infinity
    let most = -Infinity
    let lowest = Infinity
    let highest = -Infinity

    for (let one = 0; one < count; one++) {
      order[one] = one
      const px = x[one] ?? 0
      const py = y[one] ?? 0
      if (px < least) least = px
      if (px > most) most = px
      if (py < lowest) lowest = py
      if (py > highest) highest = py
    }

    const side = Math.max(most - least, highest - lowest, 1) * 1.01
    this.squares = 1
    this.build(0, 0, count, least, lowest, side, 0)
  }

  private build(
    square: number,
    low: number,
    high: number,
    x0: number,
    y0: number,
    side: number,
    depth: number,
  ) {
    const { order, scratch, x, y } = this

    this.first[square] = low
    this.inside[square] = high - low
    this.width[square] = side
    this.mass[square] = high - low

    if (high - low === 0) {
      this.child[square] = -1
      this.middleX[square] = x0
      this.middleY[square] = y0
      return
    }

    if (high - low <= IN_A_LEAF || depth >= DEEPEST) {
      this.child[square] = -1

      let sumX = 0
      let sumY = 0
      for (let step = low; step < high; step++) {
        const one = order[step] ?? 0
        sumX += x[one] ?? 0
        sumY += y[one] ?? 0
      }

      this.middleX[square] = sumX / (high - low)
      this.middleY[square] = sumY / (high - low)
      return
    }

    const half = side / 2
    const midX = x0 + half
    const midY = y0 + half

    let inTopLeft = 0
    let inTopRight = 0
    let inBottomLeft = 0
    for (let step = low; step < high; step++) {
      const one = order[step] ?? 0
      const which = quadrant(x[one] ?? 0, y[one] ?? 0, midX, midY)
      if (which === 0) inTopLeft++
      else if (which === 1) inTopRight++
      else if (which === 2) inBottomLeft++
    }

    const startTopLeft = low
    const startTopRight = startTopLeft + inTopLeft
    const startBottomLeft = startTopRight + inTopRight
    const startBottomRight = startBottomLeft + inBottomLeft

    let atTopLeft = startTopLeft
    let atTopRight = startTopRight
    let atBottomLeft = startBottomLeft
    let atBottomRight = startBottomRight

    for (let step = low; step < high; step++) {
      const one = order[step] ?? 0
      const which = quadrant(x[one] ?? 0, y[one] ?? 0, midX, midY)
      if (which === 0) scratch[atTopLeft++] = one
      else if (which === 1) scratch[atTopRight++] = one
      else if (which === 2) scratch[atBottomLeft++] = one
      else scratch[atBottomRight++] = one
    }
    for (let step = low; step < high; step++) order[step] = scratch[step] ?? 0

    this.growCells(this.squares + 4)
    const base = this.squares
    this.squares += 4
    this.child[square] = base

    const starts = [startTopLeft, startTopRight, startBottomLeft, startBottomRight]
    const ends = [startTopRight, startBottomLeft, startBottomRight, high]
    for (let which = 0; which < 4; which++) {
      this.build(
        base + which,
        starts[which] ?? low,
        ends[which] ?? low,
        which % 2 === 0 ? x0 : midX,
        which < 2 ? y0 : midY,
        half,
        depth + 1,
      )
    }

    let sumX = 0
    let sumY = 0
    for (let which = 0; which < 4; which++) {
      const weight = this.mass[base + which] ?? 0
      sumX += (this.middleX[base + which] ?? 0) * weight
      sumY += (this.middleY[base + which] ?? 0) * weight
    }

    const weight = this.mass[square] ?? 1
    this.middleX[square] = sumX / weight
    this.middleY[square] = sumY / weight
  }
}

function quadrant(px: number, py: number, midX: number, midY: number): number {
  return (px >= midX ? 1 : 0) + (py >= midY ? 2 : 0)
}
