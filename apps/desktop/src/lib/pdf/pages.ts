export interface Size {
  width: number
  height: number
}

export interface PageBox {
  top: number
  width: number
  height: number
}

export const PDF_TO_CSS = 96 / 72

export const GAP = 16

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const

export function heldZoom(value: number): number {
  return Math.min(Math.max(value, ZOOMS[0]), ZOOMS[ZOOMS.length - 1] ?? 4)
}

export function nextZoom(from: number, direction: number): number {
  const steps = direction > 0 ? [...ZOOMS] : [...ZOOMS].reverse()
  const found = steps.find((one) => (direction > 0 ? one > from + 0.001 : one < from - 0.001))

  return found ?? heldZoom(from)
}

export function sheetFor(
  at: Size,
  most: number,
  ratio: number,
): { width: number; height: number; drawn: { transform?: number[] } } {
  const room = Math.sqrt(most / (at.width * at.height))
  const density = Math.min(ratio, Math.max(1, room))

  return {
    width: Math.floor(at.width * density),
    height: Math.floor(at.height * density),
    drawn: density === 1 ? {} : { transform: [density, 0, 0, density, 0, 0] },
  }
}

export function stack(
  sizes: readonly (Size | undefined)[],
  fallback: Size,
  zoom: number,
): PageBox[] {
  const scale = zoom * PDF_TO_CSS
  const boxes: PageBox[] = []
  let top = GAP

  for (const size of sizes) {
    const page = size ?? fallback
    const height = Math.max(1, Math.floor(page.height * scale))
    boxes.push({ top, width: Math.max(1, Math.floor(page.width * scale)), height })
    top += height + GAP
  }

  return boxes
}

export function heightOf(boxes: readonly PageBox[]): number {
  const last = boxes[boxes.length - 1]
  return last ? last.top + last.height + GAP : 0
}

export function nearby(
  boxes: readonly PageBox[],
  scrollTop: number,
  viewHeight: number,
  spare = 1,
): { from: number; to: number } {
  if (!boxes.length) return { from: 0, to: 0 }

  const top = scrollTop
  const bottom = scrollTop + viewHeight
  let first = -1
  let last = -1

  for (const [index, box] of boxes.entries()) {
    if (box.top + box.height <= top || box.top >= bottom) continue
    if (first === -1) first = index
    last = index
  }

  if (first === -1) {
    const at = top < (boxes[0]?.top ?? 0) ? 0 : boxes.length - 1
    first = at
    last = at
  }

  return {
    from: Math.max(0, first - spare),
    to: Math.min(boxes.length, last + 1 + spare),
  }
}

export function pageAt(boxes: readonly PageBox[], scrollTop: number, viewHeight: number): number {
  let best = 0
  let most = -1

  for (const [index, box] of boxes.entries()) {
    const shown =
      Math.min(box.top + box.height, scrollTop + viewHeight) - Math.max(box.top, scrollTop)
    if (shown > most) {
      most = shown
      best = index + 1
    }
  }

  return best
}

export function topOfPage(boxes: readonly PageBox[], page: number): number {
  if (!boxes.length) return 0

  const at = Math.min(Math.max(1, Math.round(page)), boxes.length) - 1
  return Math.max(0, (boxes[at]?.top ?? 0) - GAP)
}
