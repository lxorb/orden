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

export class InkGrid {
  #cells = new Map<number, Set<InkStroke>>()

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
    this.#under(strokeBox(stroke), (key) => {
      const cell = this.#cells.get(key)
      if (cell) cell.add(stroke)
      else this.#cells.set(key, new Set([stroke]))
    })
  }

  remove(stroke: InkStroke) {
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

    this.#under(box, (key) => {
      const cell = this.#cells.get(key)
      if (!cell) return

      const across = Math.floor(key / SPAN) - HALF
      const down = (key % SPAN) - HALF

      for (const stroke of cell) {
        const its = strokeBox(stroke)
        if (
          its.x >= box.x + box.width ||
          box.x >= its.x + its.width ||
          its.y >= box.y + box.height ||
          box.y >= its.y + its.height
        ) {
          continue
        }

        const firstAcross = Math.max(left, cellOf(its.x))
        const firstDown = Math.max(top, cellOf(its.y))
        if (firstAcross === across && firstDown === down) out.push(stroke)
      }
    })

    return out
  }
}
