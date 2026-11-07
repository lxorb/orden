import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'

const CELL = 256

const SPAN = 2 ** 21
const HALF = 2 ** 20

function cellOf(value: number): number {
  return Math.max(-HALF, Math.min(HALF - 1, Math.floor(value / CELL)))
}

function keyOf(across: number, down: number): number {
  return (across + HALF) * SPAN + (down + HALF)
}

const MOST_CELLS = 1024

function cellsUnder(box: Box): number {
  return (
    (cellOf(box.x + box.width) - cellOf(box.x) + 1) *
    (cellOf(box.y + box.height) - cellOf(box.y) + 1)
  )
}

function meets(its: Box, box: Box): boolean {
  return (
    its.x < box.x + box.width &&
    box.x < its.x + its.width &&
    its.y < box.y + box.height &&
    box.y < its.y + its.height
  )
}

export class InkGrid {
  #cells = new Map<number, Set<InkStroke>>()
  readonly #wide = new Set<InkStroke>()

  #under(box: Box, visit: (key: number) => void) {
    const left = cellOf(box.x)
    const right = cellOf(box.x + box.width)
    const top = cellOf(box.y)
    const bottom = cellOf(box.y + box.height)

    for (let across = left; across <= right; across++) {
      for (let down = top; down <= bottom; down++) visit(keyOf(across, down))
    }
  }

  add(stroke: InkStroke) {
    if (cellsUnder(strokeBox(stroke)) > MOST_CELLS) {
      this.#wide.add(stroke)
      return
    }

    this.#under(strokeBox(stroke), (key) => {
      const cell = this.#cells.get(key)
      if (cell) cell.add(stroke)
      else this.#cells.set(key, new Set([stroke]))
    })
  }

  remove(stroke: InkStroke) {
    this.#wide.delete(stroke)
    if (cellsUnder(strokeBox(stroke)) > MOST_CELLS) return

    this.#under(strokeBox(stroke), (key) => {
      const cell = this.#cells.get(key)
      if (!cell) return

      cell.delete(stroke)
      if (!cell.size) this.#cells.delete(key)
    })
  }

  near(box: Box): InkStroke[] {
    const out: InkStroke[] = []
    const left = cellOf(box.x)
    const top = cellOf(box.y)

    if (cellsUnder(box) > MOST_CELLS) {
      for (const cell of this.#cells.values()) {
        for (const stroke of cell) if (meets(strokeBox(stroke), box)) out.push(stroke)
      }
      for (const stroke of this.#wide) if (meets(strokeBox(stroke), box)) out.push(stroke)
      return [...new Set(out)]
    }

    this.#under(box, (key) => {
      const cell = this.#cells.get(key)
      if (!cell) return

      const across = Math.floor(key / SPAN) - HALF
      const down = (key % SPAN) - HALF

      for (const stroke of cell) {
        const its = strokeBox(stroke)
        if (!meets(its, box)) continue

        const firstAcross = Math.max(left, cellOf(its.x))
        const firstDown = Math.max(top, cellOf(its.y))
        if (firstAcross === across && firstDown === down) out.push(stroke)
      }
    })

    for (const stroke of this.#wide) if (meets(strokeBox(stroke), box)) out.push(stroke)
    return out
  }
}
